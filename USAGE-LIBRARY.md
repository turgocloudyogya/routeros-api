# USAGE-LIBRARY: RouterOS API — Node.js

This file documents how AI agents should use the `routeros-api` Node.js library.
Install from repo: `npm install git+https://github.com/turgocloudyogya/routeros-api.git`

## Imports & Module System

```typescript
// TypeScript / ESM
import { Client, ConnectionPool } from "routeros-api"
import { RouterOSAPIError, TimeoutError, AuthenticationError, ConnectionError, ProtocolError, RetryExhaustedError, AbortError } from "routeros-api"
import type { ClientConfig, SSLOptions, RetryConfig, HealthCheckConfig, QueryOptions, PoolStats, SendEvent, ReceiveEvent, QueryValue, QueryRow } from "routeros-api"

// CommonJS
const { Client, RouterOSAPIError, TimeoutError } = require("routeros-api")
```

## Instantiation

```typescript
// Minimal — all defaults apply
const client = new Client()

// Custom config
const client = new Client({
  host: "192.168.88.1",       // default: "192.168.88.1"
  port: 8728,                  // default: 8728 (8729 for SSL)
  ssl: false,                  // boolean | SSLOptions
  username: "admin",           // default: "admin"
  password: "",                // default: ""
  timeout: 5000,               // connect timeout ms, default: 5000
  queryTimeout: 0,             // per-query timeout ms, 0 = no timeout
  poolSize: 3,                 // connections in pool, default: 3
  autoConnect: true,           // connect on first query, default: true
  idleTimeout: 0,              // close socket after idle ms, 0 = disabled
  autoFormat: false,           // auto-convert values: "123"→123, "true"→true, etc.
  retry: {                     // retry on failure (default: { retries: 0 })
    retries: 3,
    minDelay: 1000,
    maxDelay: 30000,
  },
  healthCheck: {               // periodic keep-alive
    interval: 30000,           // ms
    timeout: 5000,             // optional per-check timeout
    command: ["/system/identity/print"], // optional custom command
  },
})

// SSL options
const client = new Client({
  ssl: true, // shortcut — skipVerify: true

  ssl: { ca: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----", skipVerify: false },

  ssl: {
    cert: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
    key: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
    ca: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
    skipVerify: false,
  },
})
```

## Auto-Format (`autoFormat: true`)

When enabled, numeric strings and booleans are auto-converted in query results:

```typescript
const client = new Client({ autoFormat: true })

const r = await client.query(["/interface/print"])
// Without autoFormat: r[0].running → "true" (string)
// With autoFormat:    r[0].running → true (boolean)
//                    r[0]["mtu"] → 1500 (number)
```

The return type changes from `Record<string, string>[]` to `QueryRow[]` where:

```typescript
type QueryValue = string | number | boolean
type QueryRow = Record<string, QueryValue>
```

Auto-formatting skips IP addresses, CIDRs, and MAC addresses to preserve their string form. The `autoFormatValue()` and `formatRows()` functions are exported for manual use.

## Core API Methods

### `client.query(cmd, opts?)` — throws on error

```typescript
const ifaces = await client.query(["/interface/print"])
// Returns: Array<Record<string, string>>  (autoFormat: false)
//          QueryRow[]                      (autoFormat: true)
// Example: [{ ".id": "*1", name: "ether1", type: "ether", running: "true" }]

const identity = await client.query(["/system/identity/print"])
// identity[0].name → "MyRouter"

const ping = await client.query(["/tool/ping", "=address=10.0.0.1", "=count=3"])
// ping is array of !re rows

// With AbortSignal
const ac = new AbortController()
setTimeout(() => ac.abort(), 5000)
try {
  const r = await client.query(["/tool/ping", "=count=100"], { signal: ac.signal })
} catch (e) {
  if (e instanceof AbortError) console.log("cancelled")
}
```

### `client.querySafe(cmd, opts?)` — never throws

```typescript
const result = await client.querySafe(["/interface/print"])
if (result.isError) {
  console.error(result.error.message) // result.error is RouterOSAPIError
} else {
  console.log(result.data) // Array<Record<string, string>>
}
```

### `client.queryStream(cmd, opts?)` — streaming

```typescript
const rows = await client.queryStream(["/ip/address/print"], {
  onRow: (row) => {
    // called per !re sentence as it arrives
    console.log("streamed row:", row)
  },
  signal: ac.signal, // optional AbortSignal
})
// rows: all accumulated results once !done received
```

### `client.stats()` — pool statistics

```typescript
const s: PoolStats = client.stats()
// {
//   totalConnections: number,
//   activeConnections: number,
//   destroyedConnections: number,
//   queuedTasks: number,
//   totalQueries: number,
//   failedQueries: number,
//   uptime: number, // ms since pool creation
// }
```

### `client.close()` — cleanup

```typescript
await client.close()
```

## Events

```typescript
client.on("connect", (e: StatusEvent) => {})          // pool connected
client.on("disconnect", (e: StatusEvent) => {})        // pool disconnected
client.on("send", (e: SendEvent) => {})                // { id, cmd }
client.on("receive", (e: ReceiveEvent) => {})          // { id, data }
client.on("row", (e: { id: string, data: QueryRow }) => {})  // QueryRow when autoFormat enabled

client.off("send", myCallback)                         // remove listener
```

## Command Format

Commands are arrays of strings following RouterOS API syntax:

```typescript
// Read commands
["/ip/address/print"]
["/interface/print"]
["/system/identity/print"]
["/ip/route/print"]
["/tool/ping", "=address=10.0.0.1", "=count=3"]

// Write commands (mock server responds with [{ success: "true" }], real router returns !done)
["/interface/bridge/add", "=name=my-bridge"]
["/interface/vlan/add", "=name=my-vlan", "=vlan-id=100", "=interface=ether1"]
["/ip/address/add", "=address=10.10.1.1/24", "=interface=bridge", "=comment=test"]
["/interface/bridge/remove", "=.id=*1"]
["/ip/address/remove", "=.id=*4"]

// Key-value arguments follow RouterOS conventions:
//   =key=value    — string attribute
//   =.id=*1       — .id attribute (special)
```

## Error Handling

All errors extend `RouterOSAPIError` with optional `.id` (command ID) and `.detail` (parsed error attributes).

```typescript
import { RouterOSAPIError, TimeoutError, AuthenticationError, ConnectionError, ProtocolError, RetryExhaustedError, AbortError }

try {
  await client.query(["/ip/address/print"])
} catch (e) {
  if (e instanceof TimeoutError) {
    // queryTimeout exceeded or connect timeout
  } else if (e instanceof AuthenticationError) {
    // wrong username/password
  } else if (e instanceof ConnectionError) {
    // connection refused, closed, destroyed
  } else if (e instanceof ProtocolError) {
    // router returned !trap with message
    console.log(e.message, e.id, e.detail)
  } else if (e instanceof RetryExhaustedError) {
    // all retries failed, e.cause has last error
  } else if (e instanceof AbortError) {
    // cancelled via AbortSignal
  } else if (e instanceof RouterOSAPIError) {
    // base error
  }
}
```

## Patterns & Best Practices

### Auto-Connect (default)

```typescript
const client = new Client({ autoConnect: true }) // default
// No explicit connect() needed
await client.query(["/system/identity/print"])
```

### Explicit Connect

```typescript
const client = new Client({ autoConnect: false })
await client.connect()
await client.query(["/system/identity/print"])
```

### Concurrent Queries

Pool distributes queries across connections via round-robin. `poolSize` should match expected concurrency.

```typescript
const [addrs, ifaces, sys] = await Promise.all([
  client.query(["/ip/address/print"]),
  client.query(["/interface/print"]),
  client.query(["/system/identity/print"]),
])
```

### Retry on Transient Errors

```typescript
const client = new Client({
  retry: { retries: 3, minDelay: 1000, maxDelay: 10000 },
})
// AuthenticationError and AbortError are NOT retried
// ConnectionError and ProtocolError ARE retried
```

### Health Checks

```typescript
const client = new Client({
  healthCheck: { interval: 30000 },
})
// runs "/system/identity/print" every 30s to keep connections alive
```

```typescript
// Low-level access
import { Connection, ConnectionPool, TaskQueue, encodeWord, decodeWord, buildCommand, parseResponse, splitSentences } from "routeros-api"
```

## Type Definitions Summary

```typescript
interface ClientConfig {
  host?: string                    // default "192.168.88.1"
  port?: number                    // default 8728
  ssl?: boolean | SSLOptions       // default false
  username?: string                // default "admin"
  password?: string                // default ""
  timeout?: number                 // connect timeout ms, default 5000
  queryTimeout?: number            // per-query timeout ms, 0 = disabled
  poolSize?: number                // default 3
  autoConnect?: boolean            // default true
  idleTimeout?: number             // ms, 0 = disabled
  autoFormat?: boolean             // auto-convert values, default false
  retry?: RetryConfig              // { retries, minDelay, maxDelay }
  healthCheck?: HealthCheckConfig  // { interval, timeout?, command? }
}

interface SSLOptions {
  cert?: string                    // PEM client cert
  key?: string                     // PEM client key
  ca?: string                      // PEM CA cert
  skipVerify?: boolean             // default true
}

interface RetryConfig {
  retries: number
  minDelay: number                 // ms
  maxDelay: number                 // ms
}

interface HealthCheckConfig {
  interval: number                 // ms
  timeout?: number                 // ms
  command?: string[]               // default ["/system/identity/print"]
}

interface PoolStats {
  totalConnections: number
  activeConnections: number
  destroyedConnections: number
  queuedTasks: number
  totalQueries: number
  failedQueries: number
  uptime: number                   // ms
}

// autoFormat value types
type QueryValue = string | number | boolean
type QueryRow = Record<string, QueryValue>
```
