import * as net from "net"
import * as tls from "tls"
import { EventEmitter } from "events"
import { TaskQueue } from "./queue"
import { buildCommand, parseResponse, splitSentences, formatRows, QueryRow } from "./protocol"
import { decodeWord } from "./decoder"
import {
  TimeoutError,
  AuthenticationError,
  ConnectionError,
  ProtocolError,
  AbortError,
} from "./errors"
import { Task, SendEvent, ReceiveEvent, SSLOptions } from "./types"

function generateId(firstCmd: string): string {
  const chars = "abcdef1234567890"
  const prefix = firstCmd.replace(/[^a-zA-Z]/g, "-").replace(/^-+|-+$/g, "") || "cmd"
  const rand = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
  return `${prefix}-${rand}`
}

function normalizeSSLOptions(ssl?: boolean | SSLOptions): SSLOptions | false {
  if (ssl === false || ssl === undefined) return false
  if (ssl === true) return { skipVerify: true }
  return { skipVerify: true, ...ssl }
}

export class Connection extends EventEmitter {
  private socket: net.Socket | tls.TLSSocket | null = null
  private queue = new TaskQueue()
  private buffer = Buffer.alloc(0)
  private connected = false
  private authenticated = false
  private destroyed = false
  private connecting = false

  private host: string
  private port: number
  private sslOpts: SSLOptions | false
  private username: string
  private password: string
  private timeout: number
  private queryTimeout: number
  private idleTimeout: number
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private lastActivity: number = 0
  private autoFormat: boolean

  public stats = {
    totalQueries: 0,
    failedQueries: 0,
  }

  constructor(config: {
    host: string
    port: number
    ssl?: boolean | SSLOptions
    username: string
    password: string
    timeout: number
    queryTimeout: number
    idleTimeout: number
    autoFormat?: boolean
  }) {
    super()
    this.host = config.host
    this.port = config.port
    this.sslOpts = normalizeSSLOptions(config.ssl)
    this.username = config.username
    this.password = config.password
    this.timeout = config.timeout
    this.queryTimeout = config.queryTimeout
    this.idleTimeout = config.idleTimeout
    this.autoFormat = config.autoFormat ?? false
  }

  async connect(): Promise<void> {
    if (this.destroyed) throw new ConnectionError("Connection is destroyed")
    if (this.connecting) return
    if (this.isConnected) return

    this.connecting = true
    this.killIdleTimer()

    return new Promise((resolve, reject) => {
      if (this.sslOpts) {
        const tlsOpts: tls.ConnectionOptions = {
          host: this.host,
          port: this.port,
          rejectUnauthorized: this.sslOpts.skipVerify === false,
        }
        if (this.sslOpts.cert) tlsOpts.cert = this.sslOpts.cert
        if (this.sslOpts.key) tlsOpts.key = this.sslOpts.key
        if (this.sslOpts.ca) tlsOpts.ca = this.sslOpts.ca
        this.socket = tls.connect(tlsOpts)
      } else {
        this.socket = new net.Socket()
        ;(this.socket as net.Socket).connect(this.port, this.host)
      }

      const timeout = setTimeout(() => {
        this.connecting = false
        this.destroy()
        reject(new TimeoutError("Connection timeout"))
      }, this.timeout)

      this.socket.on("connect", () => {
        this.connected = true
        this.login()
          .then(() => {
            clearTimeout(timeout)
            this.connecting = false
            this.authenticated = true
            this.touch()
            this.emit("connected")
            resolve()
          })
          .catch((err) => {
            clearTimeout(timeout)
            this.connecting = false
            this.destroy()
            reject(err)
          })
      })

      this.socket.on("data", (data: Buffer) => {
        this.handleData(data)
      })

      this.socket.on("error", (err: Error) => {
        clearTimeout(timeout)
        this.connecting = false
        this.closeSocket()
        reject(new ConnectionError(err.message))
      })

      this.socket.on("close", () => {
        this.connected = false
        this.authenticated = false
        this.emit("disconnected")
      })

      this.socket.on("end", () => {
        this.connected = false
        this.authenticated = false
        this.emit("disconnected")
      })
    })
  }

  private touch(): void {
    this.lastActivity = Date.now()
    this.killIdleTimer()
    if (this.idleTimeout > 0 && !this.destroyed) {
      this.idleTimer = setTimeout(() => {
        if (this.destroyed) return
        if (Date.now() - this.lastActivity >= this.idleTimeout && this.connected) {
          this.closeSocket()
        }
      }, this.idleTimeout)
      this.idleTimer.unref()
    }
  }

  private killIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private async login(): Promise<void> {
    return new Promise((resolve, reject) => {
      const loginCmd = ["/login", `=name=${this.username}`, `=password=${this.password}`]
      const id = generateId("/login")
      const task: Task = {
        id,
        cmd: loginCmd,
        resolve: () => resolve(),
        reject,
      }
      this.queue.enqueue(task)
      this.sendNext()
    })
  }

  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data])
    const words = decodeWord(this.buffer)

    // Emit intermediate !re rows for streaming (before !done arrives)
    this.emitStreamRows(words)

    const hasDone = words.find((w) => w === "!done")
    const hasTrap = words.find((w) => w === "!trap")
    if (!hasDone && !hasTrap) return

    this.buffer = Buffer.alloc(0)
    const raw = parseResponse(words)
    const parsed = this.autoFormat ? formatRows(raw) : raw
    const task = this.queue.getPending()
    this.queue.complete()
    this.touch()

    if (task) {
      if (task.timer) clearTimeout(task.timer)

      if (parsed[0]?.message) {
        const { message, ...rest } = parsed[0]
        const detail = Object.keys(rest).length > 0 ? rest : undefined
        this.emit("receive", { id: task.id, data: parsed })
        this.stats.failedQueries++
        const isLogin = task.cmd[0] === "/login"
        const ErrClass = isLogin ? AuthenticationError : ProtocolError
        if (task.stream) {
          task.stream.rejectStream(new ErrClass(String(message || "RouterOS API error"), { id: task.id, detail }))
        } else {
          task.reject(new ErrClass(String(message || "RouterOS API error"), { id: task.id, detail }))
        }
      } else {
        this.stats.totalQueries++
        const result = task.stream ? task.stream.rows : parsed
        this.emit("receive", { id: task.id, data: result as QueryRow[] })
        if (task.stream) {
          task.stream.resolveStream(task.stream.rows)
        } else {
          task.resolve(result)
        }
      }
    }

    this.sendNext()
  }

  private emitStreamRows(words: string[]): void {
    const task = this.queue.getPending()
    if (!task || !task.stream) return
    if (words.length === 0) return

    const sentences = splitSentences(words)
    const endsWithTerminator = words[words.length - 1] === ""

    // Process all complete !re sentences (except possibly the last if not terminated)
    const limit = endsWithTerminator ? sentences.length : sentences.length - 1
    for (let i = 0; i < limit; i++) {
      const sentence = sentences[i]
      if (sentence[0] === "!re") {
        const raw = parseResponse(sentence)
        const rows = this.autoFormat ? formatRows(raw) : raw
        for (const row of rows) {
          task.stream.rows.push(row)
          if (task.stream.onRow) task.stream.onRow(row)
          this.emit("row", { id: task.id, data: row })
        }
      }
    }
  }

  private sendNext(): void {
    const task = this.queue.dequeue()
    if (!task) return

    if (!this.socket || !this.connected) {
      task.reject(new ConnectionError("Not connected", { id: task.id }))
      this.queue.complete()
      return
    }

    if (this.queryTimeout > 0 && !task.timer) {
      task.timer = setTimeout(() => {
        this.queue.complete()
        this.stats.failedQueries++
        if (task.stream) {
          task.stream.rejectStream(new TimeoutError("Query timeout", { id: task.id }))
        } else {
          task.reject(new TimeoutError("Query timeout", { id: task.id }))
        }
      }, this.queryTimeout)
    }

    if (task.signal) {
      if (task.signal.aborted) {
        this.queue.complete()
        task.reject(new AbortError("Query aborted", { id: task.id }))
        return
      }
      task.signal.addEventListener("abort", () => {
        this.queue.complete()
        this.stats.failedQueries++
        if (task.stream) {
          task.stream.rejectStream(new AbortError("Query aborted", { id: task.id }))
        } else {
          task.reject(new AbortError("Query aborted", { id: task.id }))
        }
      }, { once: true })
    }

    const cmdBuffer = buildCommand(task.cmd)
    this.emit("send", { id: task.id, cmd: task.cmd } as SendEvent)
    this.socket.write(cmdBuffer)
  }

  async execute(cmd: string[], opts?: { signal?: AbortSignal }): Promise<unknown> {
    if (!this.connected && !this.destroyed) {
      await this.connect()
    }
    if (this.destroyed) throw new ConnectionError("Connection is destroyed")

    const id = generateId(cmd[0] || "cmd")
    return new Promise((resolve, reject) => {
      const task: Task = { id, cmd, resolve, reject, signal: opts?.signal }
      this.queue.enqueue(task)
      if (!this.queue.isPending) this.sendNext()
    })
  }

  async executeStream(
    cmd: string[],
    opts?: { signal?: AbortSignal; onRow?: (row: QueryRow) => void }
  ): Promise<QueryRow[]> {
    if (!this.connected && !this.destroyed) {
      await this.connect()
    }
    if (this.destroyed) throw new ConnectionError("Connection is destroyed")

    const id = generateId(cmd[0] || "cmd")
    return new Promise((resolve, reject) => {
      const task: Task = {
        id, cmd,
        resolve: () => {},
        reject: () => {},
        signal: opts?.signal,
        stream: {
          rows: [],
          onRow: opts?.onRow,
          resolveStream: resolve,
          rejectStream: reject,
        },
      }
      this.queue.enqueue(task)
      if (!this.queue.isPending) this.sendNext()
    })
  }

  private closeSocket(): void {
    this.connected = false
    this.authenticated = false
    this.queue.clear()
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
  }

  get isConnected(): boolean {
    return this.connected && this.authenticated
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.killIdleTimer()
    this.destroyed = true
    this.closeSocket()
  }
}
