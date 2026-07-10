import { EventEmitter } from "events"
import { Connection } from "./connection"
import {
  RouterOSAPIError,
  ConnectionError,
  RetryExhaustedError,
  AuthenticationError,
  AbortError,
} from "./errors"
import {
  ClientConfig,
  SSLOptions,
  SendEvent,
  ReceiveEvent,
  RetryConfig,
  PoolStats,
} from "./types"

const defaultRetry: RetryConfig = { retries: 0, minDelay: 1000, maxDelay: 30000 }

function normalizeSSLOptions(ssl?: boolean | SSLOptions): SSLOptions | false {
  if (ssl === false || ssl === undefined) return false
  if (ssl === true) return { skipVerify: true }
  return { skipVerify: true, ...ssl }
}

export class ConnectionPool extends EventEmitter {
  private connections: Connection[] = []
  private index = 0
  private config: Required<ClientConfig>
  private inited = false
  private initPromise: Promise<void> | null = null
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private startTime = Date.now()

  private stats = {
    totalQueries: 0,
    failedQueries: 0,
  }

  constructor(config: ClientConfig = {}) {
    super()
    this.config = {
      host: config.host || "192.168.88.1",
      port: config.port || 8728,
      ssl: config.ssl ?? false,
      username: config.username || "admin",
      password: config.password || "",
      timeout: config.timeout || 5000,
      queryTimeout: config.queryTimeout || 0,
      poolSize: Math.max(1, config.poolSize || 3),
      autoConnect: config.autoConnect !== false,
      idleTimeout: config.idleTimeout || 0,
      retry: config.retry || defaultRetry,
      healthCheck: config.healthCheck || undefined as any,
    }
  }

  async init(): Promise<void> {
    if (this.inited) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this.connectAll().then(() => {
      this.inited = true
      this.startHealthChecks()
    })
    return this.initPromise
  }

  private async connectAll(): Promise<void> {
    const ssl = normalizeSSLOptions(this.config.ssl)
    const promises: Promise<void>[] = []
    for (let i = 0; i < this.config.poolSize; i++) {
      const conn = this.createConnection(ssl)
      this.connections.push(conn)
      promises.push(conn.connect())
    }
    await Promise.all(promises)
  }

  private startHealthChecks(): void {
    if (this.config.healthCheck && this.config.healthCheck.interval > 0) {
      this.healthTimer = setInterval(() => {
        const cmd = this.config.healthCheck.command || ["/system/identity/print"]
        this.execute(cmd).catch(() => {})
      }, this.config.healthCheck.interval)
      this.healthTimer.unref()
    }
  }

  private stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.connections.length === 0) {
      const ssl = normalizeSSLOptions(this.config.ssl)
      for (let i = 0; i < this.config.poolSize; i++) {
        const conn = this.createConnection(ssl)
        this.connections.push(conn)
      }
    }

    const reconnections: Promise<void>[] = []
    for (const conn of this.connections) {
      if (!conn.isConnected && !conn.isDestroyed) {
        reconnections.push(conn.connect())
      }
    }
    if (reconnections.length > 0) {
      await Promise.all(reconnections)
    }

    const allDestroyed = this.connections.length > 0 && this.connections.every(c => c.isDestroyed)
    if (allDestroyed) {
      this.connections = []
      this.inited = false
      this.initPromise = null
      await this.init()
    }

    if (!this.inited) this.inited = true
  }

  private createConnection(ssl: SSLOptions | false): Connection {
    const conn = new Connection({
      host: this.config.host,
      port: this.config.port,
      ssl: ssl || false,
      username: this.config.username,
      password: this.config.password,
      timeout: this.config.timeout,
      queryTimeout: this.config.queryTimeout,
      idleTimeout: this.config.idleTimeout,
    })

    conn.on("send", (event: SendEvent) => this.emit("send", event))
    conn.on("receive", (event: ReceiveEvent) => this.emit("receive", event))
    conn.on("row", (event: any) => this.emit("row", event))
    conn.on("error", (event: { error: string }) => this.emit("error", event))
    conn.on("connected", () => this.emit("connected"))
    conn.on("disconnected", () => this.emit("disconnected"))

    return conn
  }

  acquire(): Connection | null {
    const list = this.connections.filter(c => !c.isDestroyed)
    if (list.length === 0) return this.connections[0] || null
    const conn = list[this.index % list.length]
    this.index++
    return conn
  }

  async execute(
    cmd: string[],
    opts?: { signal?: AbortSignal }
  ): Promise<unknown> {
    await this.ensureReady()

    const retryCfg = this.config.retry
    let lastErr: Error | null = null

    for (let attempt = 0; attempt <= retryCfg.retries; attempt++) {
      try {
        const conn = this.acquire()
        if (!conn) throw new ConnectionError("No available connections")
        const result = await conn.execute(cmd, opts)
        this.stats.totalQueries++
        return result
      } catch (err) {
        lastErr = err as Error
        if (err instanceof RouterOSAPIError) {
          const apiErr = err as RouterOSAPIError
          if (apiErr instanceof AuthenticationError || apiErr instanceof AbortError) {
            throw err
          }
        }
        this.stats.failedQueries++
        if (attempt < retryCfg.retries) {
          const delay = Math.min(
            retryCfg.minDelay * Math.pow(2, attempt),
            retryCfg.maxDelay
          )
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }

    throw new RetryExhaustedError(
      `Failed after ${retryCfg.retries} retries`,
      { cause: lastErr || undefined }
    )
  }

  async executeStream(
    cmd: string[],
    opts?: { signal?: AbortSignal; onRow?: (row: Record<string, string>) => void }
  ): Promise<Record<string, string>[]> {
    await this.ensureReady()
    const conn = this.acquire()
    if (!conn) throw new ConnectionError("No available connections")
    return conn.executeStream(cmd, opts) as Promise<Record<string, string>[]>
  }

  getStats(): PoolStats {
    const now = Date.now()
    const conSummaries = this.connections.map(c => ({
      connected: c.isConnected,
      destroyed: c.isDestroyed,
    }))
    return {
      totalConnections: this.connections.length,
      activeConnections: conSummaries.filter(s => s.connected).length,
      destroyedConnections: conSummaries.filter(s => s.destroyed).length,
      queuedTasks: 0,
      totalQueries: this.stats.totalQueries,
      failedQueries: this.stats.failedQueries,
      uptime: now - this.startTime,
    }
  }

  async close(): Promise<void> {
    this.stopHealthChecks()
    this.inited = false
    this.initPromise = null
    for (const conn of this.connections) {
      conn.destroy()
    }
    this.connections = []
  }
}
