export class RouterOSAPIError extends Error {
  public id?: string
  public detail?: Record<string, string>
  public cause?: Error

  constructor(message: string, options?: { id?: string; detail?: Record<string, string>; cause?: Error }) {
    super(message)
    this.name = "RouterOSAPIError"
    this.id = options?.id
    this.detail = options?.detail
    this.cause = options?.cause
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      id: this.id,
      detail: this.detail,
      cause: this.cause?.message,
    }
  }
}

export class TimeoutError extends RouterOSAPIError {
  constructor(message: string, options?: { id?: string; detail?: Record<string, string>; cause?: Error }) {
    super(message, options)
    this.name = "RouterOSAPITimeoutError"
  }
}

export class AuthenticationError extends RouterOSAPIError {
  constructor(message: string, options?: { id?: string; detail?: Record<string, string>; cause?: Error }) {
    super(message, options)
    this.name = "RouterOSAPIAuthenticationError"
  }
}

export class ConnectionError extends RouterOSAPIError {
  constructor(message: string, options?: { id?: string; detail?: Record<string, string>; cause?: Error }) {
    super(message, options)
    this.name = "RouterOSAPIConnectionError"
  }
}

export class ProtocolError extends RouterOSAPIError {
  constructor(message: string, options?: { id?: string; detail?: Record<string, string>; cause?: Error }) {
    super(message, options)
    this.name = "RouterOSAPIProtocolError"
  }
}

export class RetryExhaustedError extends RouterOSAPIError {
  constructor(message: string, options?: { id?: string; detail?: Record<string, string>; cause?: Error }) {
    super(message, options)
    this.name = "RouterOSAPIRetryExhaustedError"
  }
}

export class AbortError extends RouterOSAPIError {
  constructor(message: string, options?: { id?: string; detail?: Record<string, string>; cause?: Error }) {
    super(message, options)
    this.name = "RouterOSAPIAbortError"
  }
}

export namespace RouterOSAPIError {
  export type Timeout = TimeoutError
  export type Authentication = AuthenticationError
  export type Connection = ConnectionError
  export type Protocol = ProtocolError
  export type RetryExhausted = RetryExhaustedError
  export type Abort = AbortError
}
