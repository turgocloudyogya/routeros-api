export interface ClientConfig {
  host?: string
  port?: number
  ssl?: boolean
  username?: string
  password?: string
  timeout?: number
  queryTimeout?: number
  poolSize?: number
}

export interface Task {
  id: string
  cmd: string[]
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer?: ReturnType<typeof setTimeout>
}

export interface SendEvent {
  id: string
  cmd: string[]
}

export interface ReceiveEvent {
  id: string
  data: Record<string, string>[]
}

export interface StatusEvent {
  status: string
  error?: string
}
