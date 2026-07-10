export class RouterOSAPIError extends Error {
  public id?: string
  public detail?: Record<string, string>

  constructor(message: string, options?: { id?: string; detail?: Record<string, string> }) {
    super(message)
    this.name = "RouterOSAPIError"
    this.id = options?.id
    this.detail = options?.detail
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      id: this.id,
      detail: this.detail,
    }
  }
}

export class TimeoutError extends RouterOSAPIError {
  constructor(message: string, options?: { id?: string; detail?: Record<string, string> }) {
    super(message, options)
    this.name = "RouterOSAPITimeoutError"
  }
}

export class AuthenticationError extends RouterOSAPIError {
  constructor(message: string, options?: { id?: string; detail?: Record<string, string> }) {
    super(message, options)
    this.name = "RouterOSAPIAuthenticationError"
  }
}

export class ConnectionError extends RouterOSAPIError {
  constructor(message: string, options?: { id?: string; detail?: Record<string, string> }) {
    super(message, options)
    this.name = "RouterOSAPIConnectionError"
  }
}

export class ProtocolError extends RouterOSAPIError {
  constructor(message: string, options?: { id?: string; detail?: Record<string, string> }) {
    super(message, options)
    this.name = "RouterOSAPIProtocolError"
  }
}

export namespace RouterOSAPIError {
  export type Timeout = TimeoutError
  export type Authentication = AuthenticationError
  export type Connection = ConnectionError
  export type Protocol = ProtocolError
}
