export interface SSLOptions {
  cert?: string
  key?: string
  ca?: string
  skipVerify?: boolean
}

export interface RetryConfig {
  retries: number
  minDelay: number
  maxDelay: number
}

export interface HealthCheckConfig {
  interval: number
  timeout?: number
  command?: string[]
}

export interface ClientConfig {
  host?: string
  port?: number
  ssl?: boolean | SSLOptions
  username?: string
  password?: string
  timeout?: number
  queryTimeout?: number
  poolSize?: number
  autoConnect?: boolean
  idleTimeout?: number
  autoFormat?: boolean
  retry?: RetryConfig
  healthCheck?: HealthCheckConfig
}

export interface QueryOptions {
  signal?: AbortSignal
}

export interface Task {
  id: string
  cmd: string[]
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer?: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  stream?: {
    rows: Record<string, string | number | boolean>[]
    onRow?: (row: Record<string, string | number | boolean>) => void
    resolveStream: (rows: Record<string, string | number | boolean>[]) => void
    rejectStream: (reason: unknown) => void
  }
}

export interface SendEvent {
  id: string
  cmd: string[]
}

export interface ReceiveEvent {
  id: string
  data: Record<string, string | number | boolean>[]
}

export interface StatusEvent {
  status: string
  error?: string
}

export interface PoolStats {
  totalConnections: number
  activeConnections: number
  destroyedConnections: number
  queuedTasks: number
  totalQueries: number
  failedQueries: number
  uptime: number
}
