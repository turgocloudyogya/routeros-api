import * as net from "net"
import * as tls from "tls"
import { EventEmitter } from "events"
import { TaskQueue } from "./queue"
import { buildCommand, parseResponse } from "./protocol"
import { decodeWord } from "./decoder"
import {
  RouterOSAPIError,
  TimeoutError,
  AuthenticationError,
  ConnectionError,
  ProtocolError,
} from "./errors"
import { Task, SendEvent, ReceiveEvent } from "./types"

function generateId(firstCmd: string): string {
  const chars = "abcdef1234567890"
  const prefix = firstCmd.replace(/[^a-zA-Z]/g, "-").replace(/^-+|-+$/g, "") || "cmd"
  const rand = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
  return `${prefix}-${rand}`
}

export class Connection extends EventEmitter {
  private socket: net.Socket | tls.TLSSocket | null = null
  private queue = new TaskQueue()
  private buffer = Buffer.alloc(0)
  private connected = false
  private authenticated = false
  private destroyed = false

  private host: string
  private port: number
  private ssl: boolean
  private username: string
  private password: string
  private timeout: number
  private queryTimeout: number

  constructor(config: {
    host: string
    port: number
    ssl: boolean
    username: string
    password: string
    timeout: number
    queryTimeout: number
  }) {
    super()
    this.host = config.host
    this.port = config.port
    this.ssl = config.ssl
    this.username = config.username
    this.password = config.password
    this.timeout = config.timeout
    this.queryTimeout = config.queryTimeout
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.destroyed) {
        return reject(new ConnectionError("Connection is destroyed"))
      }

      if (this.ssl) {
        this.socket = tls.connect({
          host: this.host,
          port: this.port,
          rejectUnauthorized: false,
        })
      } else {
        this.socket = new net.Socket()
        ;(this.socket as net.Socket).connect(this.port, this.host)
      }

      const timeout = setTimeout(() => {
        this.destroy()
        reject(new TimeoutError("Connection timeout"))
      }, this.timeout)

      this.socket.on("connect", () => {
        this.connected = true
        this.login()
          .then(() => {
            clearTimeout(timeout)
            this.authenticated = true
            this.emit("connected")
            resolve()
          })
          .catch((err) => {
            clearTimeout(timeout)
            this.destroy()
            reject(err)
          })
      })

      this.socket.on("data", (data: Buffer) => {
        this.handleData(data)
      })

      this.socket.on("error", (err: Error) => {
        clearTimeout(timeout)
        this.destroy()
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

    const hasDone = words.find((w) => w === "!done")
    const hasTrap = words.find((w) => w === "!trap")
    if (!hasDone && !hasTrap) {
      return
    }

    this.buffer = Buffer.alloc(0)
    const parsed = parseResponse(words)
    const task = this.queue.getPending()
    this.queue.complete()

    if (task) {
      if (task.timer) {
        clearTimeout(task.timer)
      }
      if (parsed[0]?.message) {
        const { message, ...rest } = parsed[0]
        const detail = Object.keys(rest).length > 0 ? rest : undefined
        this.emit("receive", { id: task.id, data: parsed })
        const isLogin = task.cmd[0] === "/login"
        const ErrClass = isLogin ? AuthenticationError : ProtocolError
        task.reject(new ErrClass(message || "RouterOS API error", {
          id: task.id,
          detail,
        }))
      } else if (parsed[0]?.category || parsed[0]?.code) {
        this.emit("receive", { id: task.id, data: parsed })
        task.reject(new ProtocolError(parsed[0].message || "RouterOS API error", {
          id: task.id,
          detail: parsed[0],
        }))
      } else {
        this.emit("receive", { id: task.id, data: parsed })
        task.resolve(parsed)
      }
    }

    this.sendNext()
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
        task.reject(new TimeoutError("Query timeout", { id: task.id }))
      }, this.queryTimeout)
    }

    const cmdBuffer = buildCommand(task.cmd)
    this.emit("send", { id: task.id, cmd: task.cmd } as SendEvent)
    this.socket.write(cmdBuffer)
  }

  async execute(cmd: string[]): Promise<unknown> {
    if (this.destroyed) {
      throw new ConnectionError("Connection is destroyed")
    }

    const id = generateId(cmd[0] || "cmd")
    return new Promise((resolve, reject) => {
      const task: Task = { id, cmd, resolve, reject }
      this.queue.enqueue(task)
      if (!this.queue.isPending) {
        this.sendNext()
      }
    })
  }

  get isConnected(): boolean {
    return this.connected && this.authenticated
  }

  destroy(): void {
    this.destroyed = true
    this.connected = false
    this.authenticated = false
    this.queue.clear()
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
  }
}
