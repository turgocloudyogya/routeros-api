import { EventEmitter } from "events"
import { ConnectionPool } from "./pool"
import { RouterOSAPIError, ConnectionError } from "./errors"
import {
  ClientConfig,
  QueryOptions,
  SendEvent,
  ReceiveEvent,
  StatusEvent,
  PoolStats,
} from "./types"

export class Client {
  private pool: ConnectionPool
  private emitter = new EventEmitter()
  private closed = false
  private autoConnect: boolean

  constructor(config: ClientConfig = {}) {
    this.autoConnect = config.autoConnect !== false
    this.pool = new ConnectionPool(config)

    this.emitter.on("error", () => {})

    this.pool.on("send", (event: SendEvent) => this.emitter.emit("send", event))
    this.pool.on("receive", (event: ReceiveEvent) => this.emitter.emit("receive", event))
    this.pool.on("row", (event: any) => this.emitter.emit("row", event))
    this.pool.on("connected", () => this.emitter.emit("connect", { status: "connect" }))
    this.pool.on("disconnected", () => this.emitter.emit("disconnect", { status: "disconnect" }))
    this.pool.on("error", (event: { error: string }) => this.emitter.emit("error", event))

    if (this.autoConnect) {
      this.pool.init().catch(() => {})
    }
  }

  async connect(): Promise<void> {
    if (this.closed) throw new ConnectionError("Client is closed")
    await this.pool.init()
  }

  async query(cmd: string[], opts?: QueryOptions): Promise<Record<string, string>[]> {
    if (this.closed) throw new ConnectionError("Client is closed")
    if (this.autoConnect) {
      await this.pool.init().catch(() => {})
    }
    const result = await this.pool.execute(cmd, opts)
    if (result === undefined || result === null) return []
    return result as Record<string, string>[]
  }

  async querySafe(
    cmd: string[],
    opts?: QueryOptions
  ): Promise<{ isError: false; data: Record<string, string>[] } | { isError: true; error: RouterOSAPIError }> {
    try {
      const data = await this.query(cmd, opts)
      return { isError: false, data }
    } catch (e) {
      if (e instanceof RouterOSAPIError) return { isError: true, error: e }
      return { isError: true, error: new RouterOSAPIError(String(e)) }
    }
  }

  async queryStream(
    cmd: string[],
    opts?: { signal?: AbortSignal; onRow?: (row: Record<string, string>) => void }
  ): Promise<Record<string, string>[]> {
    if (this.closed) throw new ConnectionError("Client is closed")
    if (this.autoConnect) {
      await this.pool.init().catch(() => {})
    }
    return this.pool.executeStream(cmd, opts)
  }

  stats(): PoolStats {
    return this.pool.getStats()
  }

  on(event: "connect" | "disconnect", callback: (event: StatusEvent) => void): this
  on(event: "send", callback: (event: SendEvent) => void): this
  on(event: "receive", callback: (event: ReceiveEvent) => void): this
  on(event: "row", callback: (event: { id: string; data: Record<string, string> }) => void): this
  on(event: "error", callback: (event: { error: string }) => void): this
  on(event: string, callback: (...args: any[]) => void): this {
    this.emitter.on(event, callback)
    return this
  }

  off(event: string, callback: (...args: any[]) => void): this {
    this.emitter.off(event, callback)
    return this
  }

  async close(): Promise<void> {
    this.closed = true
    await this.pool.close()
    this.emitter.removeAllListeners()
  }
}
