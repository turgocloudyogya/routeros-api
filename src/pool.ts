import { EventEmitter } from "events"
import { Connection } from "./connection"
import { ClientConfig, SendEvent, ReceiveEvent } from "./types"

export class ConnectionPool extends EventEmitter {
  private connections: Connection[] = []
  private index = 0
  private config: Required<Omit<ClientConfig, "poolSize">> & { poolSize: number }

  constructor(config: ClientConfig = {}) {
    super()
    this.config = {
      host: config.host || "192.168.88.1",
      port: config.port || 8728,
      ssl: config.ssl || false,
      username: config.username || "admin",
      password: config.password || "",
      timeout: config.timeout || 5000,
      queryTimeout: config.queryTimeout || 0,
      poolSize: Math.max(1, config.poolSize || 3),
    }
  }

  async init(): Promise<void> {
    const promises: Promise<void>[] = []
    for (let i = 0; i < this.config.poolSize; i++) {
      const conn = this.createConnection()
      this.connections.push(conn)
      promises.push(conn.connect())
    }
    await Promise.all(promises)
  }

  private createConnection(): Connection {
    const conn = new Connection({
      host: this.config.host,
      port: this.config.port,
      ssl: this.config.ssl,
      username: this.config.username,
      password: this.config.password,
      timeout: this.config.timeout,
      queryTimeout: this.config.queryTimeout,
    })

    conn.on("send", (event: SendEvent) => {
      this.emit("send", event)
    })

    conn.on("receive", (event: ReceiveEvent) => {
      this.emit("receive", event)
    })

    conn.on("error", (event: { error: string }) => {
      this.emit("error", event)
    })

    conn.on("connected", () => {
      this.emit("connected")
    })

    conn.on("disconnected", () => {
      this.emit("disconnected")
    })

    return conn
  }

  acquire(): Connection {
    const conn = this.connections[this.index % this.connections.length]
    this.index++
    return conn
  }

  async execute(cmd: string[]): Promise<unknown> {
    const conn = this.acquire()
    return conn.execute(cmd)
  }

  async close(): Promise<void> {
    for (const conn of this.connections) {
      conn.destroy()
    }
    this.connections = []
  }
}
