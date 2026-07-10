# RouterOS API — Node.js (Primary Library)

**This is the primary implementation.**  
The Go version is a port — see [routeros-api-go](https://github.com/turgocloudyogya/routeros-api-go).

A Mikrotik RouterOS API client for Node.js. Supports TCP and SSL connections, connection pooling, request queuing, event-based communication, and typed errors.

## Features

- **Connection Pool** — multiple TCP connections for parallel request handling
- **Request Queue** — sequential command execution per connection (RouterOS protocol requires one command at a time)
- **SSL/TLS** — connect via port 8729 with TLS
- **Events** — listen to `connect`, `disconnect`, `send`, `receive`, `error` events
- **Query Timeout** — separate timeout for per-query response
- **querySafe** — never-throw variant that returns `{ isError, data, error }`
- **Typed Errors** — `RouterOSAPIError` with subclasses: `TimeoutError`, `AuthenticationError`, `ConnectionError`, `ProtocolError`
- **TypeScript** — full type definitions included
- **Dual module** — supports both CommonJS (`require`) and ES modules (`import`)

## Installation

```bash
npm install routeros-api
```

## Quick Start

```typescript
import { Client } from "routeros-api"

const client = new Client({
  host: "192.168.88.1",
  port: 8728,
  ssl: false,
  username: "admin",
  password: "your-password",
  timeout: 5000,
  poolSize: 3,
})

await client.connect()

const addresses = await client.query(["/ip/address/print"])
console.log(addresses)

await client.close()
```

## Configuration

| Option         | Type      | Default          | Description                              |
|----------------|-----------|------------------|------------------------------------------|
| `host`         | `string`  | `192.168.88.1`   | Router IP/hostname                       |
| `port`         | `number`  | `8728`           | API port (`8729` for SSL)                |
| `ssl`          | `boolean` | `false`          | Enable TLS connection                    |
| `username`     | `string`  | `admin`          | Login username                           |
| `password`     | `string`  | `""`             | Login password                           |
| `timeout`      | `number`  | `5000`           | Connection timeout in milliseconds       |
| `queryTimeout` | `number`  | `0`              | Per-query timeout (0 = no timeout)       |
| `poolSize`     | `number`  | `3`              | Number of connections in the pool        |

## API

### `client.query(command)`

Send a command to RouterOS and return parsed results. **Throws** `RouterOSAPIError` on failure.

```typescript
const result = await client.query(["/interface/print"])
// [
//   { ".id": "*1", "name": "ether1", "type": "ether", ... },
//   { ".id": "*2", "name": "wlan1", "type": "wlan", ... }
// ]

const systemRes = await client.query(["/system/identity/print"])
// [{ "name": "MyRouter" }]
```

### `client.querySafe(command)`

Safe variant — never throws. Always returns a result object with `isError` flag.

```typescript
const result = await client.querySafe(["/interface/print"])
if (result.isError) {
  console.error("Error:", result.error.message)
  // result.error is RouterOSAPIError
} else {
  console.log("Interfaces:", result.data)
}
```

### Concurrent queries with `Promise.all`

The connection pool allows multiple queries to run in parallel:

```typescript
const [addrs, ifaces, sys] = await Promise.all([
  client.query(["/ip/address/print"]),
  client.query(["/interface/print"]),
  client.query(["/system/identity/print"]),
])
```

### Events

```typescript
client.on("connect", (event) => {
  console.log("Connected:", event.status)
})

client.on("disconnect", (event) => {
  console.log("Disconnected:", event.status)
})

client.on("send", (event) => {
  console.log("Sent command:", event.id, event.cmd)
})

client.on("receive", (event) => {
  console.log("Received data:", event.id, event.data)
})

client.on("error", (event) => {
  console.error("Error:", event.error)
})
```

### `client.close()`

Close all connections and clean up resources.

```typescript
await client.close()
```

## Error Handling

All errors extend `RouterOSAPIError` and are available as named exports:

| Error Class          | Description                        |
|----------------------|------------------------------------|
| `RouterOSAPIError`   | Base error (all types)             |
| `TimeoutError`       | Connection or query timeout        |
| `AuthenticationError`| Login failed (wrong credentials)   |
| `ConnectionError`    | Connection refused, closed, etc.   |
| `ProtocolError`      | RouterOS API returned an error trap|

```typescript
import { RouterOSAPIError, TimeoutError, AuthenticationError } from "routeros-api"

try {
  await client.query(["/ip/address/print"])
} catch (e) {
  if (e instanceof TimeoutError) {
    console.log("Request timed out")
  } else if (e instanceof AuthenticationError) {
    console.log("Bad credentials")
  } else if (e instanceof RouterOSAPIError) {
    console.log("API error:", e.message, e.id, e.detail)
  }
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
