# RouterOS API — Node.js (Primary Library)

**This is the primary implementation.**  
The Go version is a port — see [routeros-api-go](https://github.com/turgocloudyogya/routeros-api-go).

A Mikrotik RouterOS API client for Node.js. Supports TCP and SSL connections, connection pooling, request queuing, event-based communication, typed errors, streaming, retry with backoff, and health checks.

## Features

- **Connection Pool** — multiple TCP connections for parallel request handling
- **Request Queue** — sequential command execution per connection (RouterOS protocol requires one command at a time)
- **SSL/TLS** — connect via port 8729 with TLS; supports custom cert, key, CA, and `skipVerify`
- **Auto-Connect** — connects automatically on first query when `autoConnect: true`
- **Idle Timeout** — closes socket after inactivity, reopens on next query
- **Events** — listen to `connect`, `disconnect`, `send`, `receive`, `error`, `row` events
- **Query Timeout** — separate timeout for per-query response
- **querySafe** — never-throw variant that returns `{ isError, data, error }`
- **Streaming** — `queryStream()` emits rows via `onRow` callback as they arrive
- **AbortSignal** — cancel in-flight queries with any `AbortSignal`
- **Retry** — configurable exponential backoff on failure (`retries`, `minDelay`, `maxDelay`)
- **Health Check** — periodic keep-alive queries via `healthCheck` config
- **Stats** — `stats()` returns `PoolStats` with connection/query counters and uptime
- **Typed Errors** — `RouterOSAPIError` with subclasses: `TimeoutError`, `AuthenticationError`, `ConnectionError`, `ProtocolError`, `RetryExhaustedError`, `AbortError`
- **TypeScript** — full type definitions included
- **Dual module** — supports both CommonJS (`require`) and ES modules (`import`)

## Installation

```bash
npm install git+https://github.com/turgocloudyogya/routeros-api.git
```

## Quick Start

```typescript
import { Client } from "routeros-api"

const client = new Client({
  host: "192.168.88.1",
  port: 8729,
  ssl: { skipVerify: true },
  username: "admin",
  password: "your-password",
  timeout: 5000,
  poolSize: 3,
})

// autoConnect: true by default — no explicit connect() needed
const addresses = await client.query(["/ip/address/print"])
console.log(addresses)

await client.close()
```

## Configuration

| Option         | Type                    | Default          | Description                              |
|----------------|-------------------------|------------------|------------------------------------------|
| `host`         | `string`                | `192.168.88.1`   | Router IP/hostname                       |
| `port`         | `number`                | `8728`           | API port (`8729` for SSL)                |
| `ssl`          | `boolean \| SSLOptions` | `false`          | Enable TLS / TLS options                 |
| `username`     | `string`                | `admin`          | Login username                           |
| `password`     | `string`                | `""`             | Login password                           |
| `timeout`      | `number`                | `5000`           | Connection timeout in milliseconds       |
| `queryTimeout` | `number`                | `0`              | Per-query timeout (0 = no timeout)       |
| `poolSize`     | `number`                | `3`              | Number of connections in the pool        |
| `autoConnect`  | `boolean`               | `true`           | Auto-connect on first query              |
| `idleTimeout`  | `number`                | `0`              | Close socket after idle ms (0 = disabled)|
| `retry`        | `RetryConfig`           | `{retries:0}`    | Retry with exponential backoff           |
| `healthCheck`  | `HealthCheckConfig`     | —                | Periodic health check config             |

### SSLOptions

```typescript
interface SSLOptions {
  cert?: string        // Custom client certificate
  key?: string         // Client certificate key
  ca?: string          // Custom CA certificate
  skipVerify?: boolean // Skip TLS verification (default: true)
}
```

### RetryConfig

```typescript
interface RetryConfig {
  retries: number   // Max retry attempts (default: 0)
  minDelay: number  // Initial backoff delay in ms (default: 1000)
  maxDelay: number  // Maximum backoff delay in ms (default: 30000)
}
```

### HealthCheckConfig

```typescript
interface HealthCheckConfig {
  interval: number  // Interval in ms between health checks
  timeout?: number  // Query timeout for health check
  command?: string[] // Custom command (default: ["/system/identity/print"])
}
```

## API

### `client.query(command, opts?)`

Send a command to RouterOS and return parsed results. **Throws** on failure.

```typescript
const result = await client.query(["/interface/print"])
// [{ ".id": "*1", "name": "ether1", "type": "ether" }, ...]

const systemRes = await client.query(["/system/identity/print"])
// [{ "name": "MyRouter" }]
```

With `AbortSignal`:

```typescript
const ac = new AbortController()
setTimeout(() => ac.abort(), 1000)

try {
  const r = await client.query(["/tool/ping", "=address=10.0.0.1", "=count=100"], { signal: ac.signal })
} catch (e) {
  if (e instanceof AbortError) console.log("Query cancelled")
}
```

### `client.queryStream(command, opts?)`

Stream rows as they arrive from the server. Returns all rows once `!done` is received.

```typescript
const rows = await client.queryStream(["/ip/address/print"], {
  onRow: (row) => {
    console.log("Got row:", row)
  },
})
// rows contains all results
```

### `client.querySafe(command)`

Never throws. Always returns `{ isError, data, error }`.

```typescript
const result = await client.querySafe(["/interface/print"])
if (result.isError) {
  console.error("Error:", result.error.message)
} else {
  console.log("Interfaces:", result.data)
}
```

### `client.stats()`

Returns pool statistics.

```typescript
const s = client.stats()
console.log(s.totalQueries, s.activeConnections, s.uptime)
```

### Events

```typescript
client.on("connected", () => console.log("Connected"))
client.on("disconnected", () => console.log("Disconnected"))
client.on("send", (e) => console.log("Sent:", e.id, e.cmd))
client.on("receive", (e) => console.log("Received:", e.id, e.data))
client.on("row", (e) => console.log("Row:", e.id, e.data))
client.on("error", (e) => console.error("Error:", e.error))
```

### Concurrent queries

The pool allows multiple queries in parallel:

```typescript
const [addrs, ifaces, sys] = await Promise.all([
  client.query(["/ip/address/print"]),
  client.query(["/interface/print"]),
  client.query(["/system/identity/print"]),
])
```

### `client.close()`

Close all connections and clean up.

```typescript
await client.close()
```

## Error Handling

| Error Class             | Description                        |
|-------------------------|------------------------------------|
| `RouterOSAPIError`      | Base error (all types)             |
| `TimeoutError`          | Connection or query timeout        |
| `AuthenticationError`   | Login failed (wrong credentials)   |
| `ConnectionError`       | Connection refused, closed, etc.   |
| `ProtocolError`         | RouterOS API returned an error trap|
| `RetryExhaustedError`   | All retry attempts failed          |
| `AbortError`            | Query cancelled via AbortSignal    |

```typescript
import { TimeoutError, AuthenticationError, AbortError } from "routeros-api"

try {
  await client.query(["/ip/address/print"])
} catch (e) {
  if (e instanceof TimeoutError) console.log("Timed out")
  else if (e instanceof AuthenticationError) console.log("Bad credentials")
  else if (e instanceof RouterOSAPIError) console.log("API error:", e.message)
}
```

## How It Works

### Protocol

RouterOS API uses a simple word-based protocol over TCP:
- Each word is length-prefixed with a variable-length encoding (1–5 bytes)
- Commands are sent as arrays of words terminated by an empty word
- Responses use `!re`, `!trap`, and `!done` markers

### Queue System

Each connection maintains a FIFO queue. A command is sent only after the
previous command's `!done` response is received. This is required because
RouterOS processes commands sequentially per connection.

### Connection Pool

The pool maintains multiple connections (default: 3). Requests are distributed
across connections using round-robin. This allows parallel command execution.

## License

Apache-2.0
