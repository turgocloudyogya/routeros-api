import { EventEmitter } from "events"
import { ConnectionPool } from "./pool"
import { RouterOSAPIError, ConnectionError } from "./errors"
import { ClientConfig, SendEvent, ReceiveEvent, StatusEvent } from "./types"

export class Client {
  private pool: ConnectionPool
  private emitter = new EventEmitter()
  private closed = false

  constructor(config: ClientConfig = {}) {
    this.pool = new ConnectionPool(config)

    this.emitter.on("error", () => {})

    this.pool.on("send", (event: SendEvent) => {
      this.emitter.emit("send", event)
    })

    this.pool.on("receive", (event: ReceiveEvent) => {
      this.emitter.emit("receive", event)
    })

    this.pool.on("connected", () => {
      this.emitter.emit("connect", { status: "connect" })
    })

    this.pool.on("disconnected", () => {
      this.emitter.emit("disconnect", { status: "disconnect" })
    })

    this.pool.on("error", (event: { error: string }) => {
      this.emitter.emit("error", event)
    })
  }

  async connect(): Promise<void> {
    if (this.closed) throw new ConnectionError("Client is closed")
    await this.pool.init()
  }

  async query(cmd: string[]): Promise<Record<string, string>[]> {
    if (this.closed) throw new ConnectionError("Client is closed")
    const result = await this.pool.execute(cmd)
    if (result === undefined || result === null) return []
    return result as Record<string, string>[]
  }

  async querySafe(cmd: string[]): Promise<{ isError: false; data: Record<string, string>[] } | { isError: true; error: RouterOSAPIError }> {
    try {
      const data = await this.query(cmd)
      return { isError: false, data }
    } catch (e) {
      if (e instanceof RouterOSAPIError) {
        return { isError: true, error: e }
      }
      return { isError: true, error: new RouterOSAPIError(String(e)) }
    }
  }

  on(event: "connect" | "disconnect", callback: (event: StatusEvent) => void): this
  on(event: "send", callback: (event: SendEvent) => void): this
  on(event: "receive", callback: (event: ReceiveEvent) => void): this
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
