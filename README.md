# pm2-web-logger

`pm2-web-logger` is a lightweight HTTP and SSE service for exposing PM2 log files without adding a database, Redis, Loki, or a required browser UI.

It reads PM2 log files from `.pm2/logs`, keeps only the latest `N` lines in memory per source, returns snapshots over HTTP, and streams new lines via Server-Sent Events.

## Why

- You want the last PM2 logs over HTTP from a single server.
- You want realtime updates without WebSockets.
- You do not want a full observability stack for a simple deployment.
- You want something that can sit next to an app managed by PM2.

## Features

- Reads `*-out.log` and `*-error.log` files for one or more PM2 apps
- Ring buffer per source with fixed memory bounds
- Snapshot endpoint for the latest lines
- SSE endpoint for realtime log delivery
- Startup tail loading without reading whole files into memory
- Poll-based file watching with truncate and rotation recovery
- Optional bearer token protection for `/api/*`
- `.env`-only configuration with runtime validation
- Graceful shutdown for HTTP server, watchers, and SSE clients
- Typed TypeScript codebase with Vitest, ESLint, and Prettier

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Minimal `.env`:

```env
PORT=3710
HOST=0.0.0.0
PM2_LOGS_DIR=/home/deploy/.pm2/logs
APPS=strapi
BUFFER_SIZE=1000
MAX_HTTP_LIMIT=1000
READ_EXISTING_ON_START=true
FILE_POLL_INTERVAL_MS=500
MAX_LINE_LENGTH=16384
SSE_HEARTBEAT_MS=15000
ENABLE_CORS=false
CORS_ORIGIN=
LOG_LEVEL=info
AUTH_TOKEN=change_me
BASE_PATH=/
```

For multiple web-console origins:

```env
ENABLE_CORS=true
CORS_ORIGIN=http://127.0.0.1:5500,http://localhost:5500,https://logs.example.com
```

Build and run in production:

```bash
npm run build
npm start
```

## How It Works

For every configured app, the service tracks:

- `<PM2_LOGS_DIR>/<app>-out.log`
- `<PM2_LOGS_DIR>/<app>-error.log`

At startup it can read the last `BUFFER_SIZE` lines from existing files and fill the in-memory buffer. After that it polls files for changes, ingests appended lines, detects truncation or replacement, and sends new lines to SSE subscribers.

`timestamp` values in API responses are ingestion timestamps produced by `pm2-web-logger`. They are not parsed from the original log line.

## Installation

### Local Node.js

Requirements:

- Node.js 20+
- npm 10+

Install dependencies:

```bash
npm install
```

### Docker

```bash
docker build -t pm2-web-logger .
docker run --rm \
  --env-file .env \
  -p 3710:3710 \
  -v /home/deploy/.pm2/logs:/home/deploy/.pm2/logs:ro \
  pm2-web-logger
```

An example [`docker-compose.yml`](./docker-compose.yml) is included.

## Configuration

All runtime settings come from `.env`.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | no | `3710` | HTTP port |
| `HOST` | no | `0.0.0.0` | Bind host |
| `PM2_LOGS_DIR` | yes | - | Absolute path to PM2 logs directory |
| `APPS` | yes | - | Comma-separated PM2 app names, for example `strapi,worker,api` |
| `BUFFER_SIZE` | no | `1000` | Ring buffer size per source |
| `MAX_HTTP_LIMIT` | no | `1000` | Maximum allowed `limit` on `GET /api/logs` |
| `READ_EXISTING_ON_START` | no | `true` | Read tail from existing files during startup and after rotation |
| `FILE_POLL_INTERVAL_MS` | no | `500` | Poll interval used to detect file changes |
| `MAX_LINE_LENGTH` | no | `16384` | Safety limit for a single line before truncation |
| `SSE_HEARTBEAT_MS` | no | `15000` | Heartbeat interval for SSE clients |
| `ENABLE_CORS` | no | `false` | Enable CORS support |
| `CORS_ORIGIN` | conditional | empty | Allowed origin list when `ENABLE_CORS=true`, comma-separated |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, or `error` |
| `AUTH_TOKEN` | no | empty | Bearer token required for `/api/*` when set |
| `BASE_PATH` | no | `/` | Prefix for all routes, for example `/_logs` |

Configuration is validated on startup with Zod. Invalid values fail fast with a readable error.

## API

If `BASE_PATH=/`, the default routes are:

- `GET /health`
- `GET /api/sources`
- `GET /api/logs?app=<name>&stream=out|error|all&limit=<n>`
- `GET /api/logs/stream?app=<name>&stream=out|error|all`

If `BASE_PATH=/_logs`, the same routes become:

- `GET /_logs/health`
- `GET /_logs/api/sources`
- `GET /_logs/api/logs`
- `GET /_logs/api/logs/stream`

### `GET /health`

Returns service status, uptime, version, and current source states.

Example:

```bash
curl http://127.0.0.1:3710/health
```

### `GET /api/sources`

Returns configured sources and current file state.

Protected by bearer auth when `AUTH_TOKEN` is set.

```bash
curl -H "Authorization: Bearer change_me" \
  "http://127.0.0.1:3710/api/sources"
```

### `GET /api/logs`

Returns the latest buffered lines for a single source, or for both streams together when `stream=all`.

```bash
curl -H "Authorization: Bearer change_me" \
  "http://127.0.0.1:3710/api/logs?app=strapi&stream=out&limit=100"
```

Merged console view:

```bash
curl -H "Authorization: Bearer change_me" \
  "http://127.0.0.1:3710/api/logs?app=strapi&stream=all&limit=100"
```

Example response:

```json
{
  "app": "strapi",
  "stream": "out",
  "limit": 100,
  "lines": [
    {
      "line": "Starting application...",
      "timestamp": "2026-04-01T12:00:00.000Z",
      "truncated": false,
      "stream": "out"
    }
  ]
}
```

### HTML Console Example

A standalone browser example is available at [`examples/web-console.html`](./examples/web-console.html).

It includes:

- `IP / Domain`
- `Stream Name`
- `Stream Filter`
- optional bearer token
- a live log console

The page first loads the latest buffered lines from `GET /api/logs` and then keeps the console live via `GET /api/logs/stream`.

Usage:

1. Open the file in a browser, or serve it as a static page.
2. Enter the server URL, app name, and `out`, `error`, or `all`.
3. If `AUTH_TOKEN` is enabled, enter the bearer token.
4. Click `Connect`.

If the HTML page is hosted on a different origin, enable CORS on `pm2-web-logger`. If the page is opened over `https://`, the API should also be exposed over `https://`, usually through a reverse proxy in front of `pm2-web-logger`.

### `GET /api/logs/stream`

Streams new log lines over SSE. Use `stream=all` when one web console should receive both `out` and `error`.

```bash
curl -N -H "Authorization: Bearer change_me" \
  "http://127.0.0.1:3710/api/logs/stream?app=strapi&stream=error"
```

Merged console stream:

```bash
curl -N -H "Authorization: Bearer change_me" \
  "http://127.0.0.1:3710/api/logs/stream?app=strapi&stream=all"
```

SSE events:

- `ready`: initial stream metadata
- `log`: one newly ingested line
- `: heartbeat`: comment heartbeat frame to keep proxies and clients alive

Example `log` payload:

```json
{
  "app": "strapi",
  "stream": "error",
  "line": "runtime failure",
  "timestamp": "2026-04-01T12:00:00.000Z",
  "truncated": false
}
```

## PM2 Usage

Example PM2 app:

```bash
pm2 start dist/cli.js --name strapi
```

Example PM2 log files:

- `/home/deploy/.pm2/logs/strapi-out.log`
- `/home/deploy/.pm2/logs/strapi-error.log`

Example PM2 ecosystem config for `pm2-web-logger` itself is included at [`examples/ecosystem.config.cjs`](./examples/ecosystem.config.cjs).

## Reverse Proxy Notes

For Nginx or another reverse proxy:

- Disable response buffering for the SSE endpoint
- Keep connection timeouts high enough for long-lived streams
- Forward `Authorization` headers if you use bearer auth
- Preserve `Cache-Control: no-cache` semantics for SSE

An example Nginx config is included at [`examples/nginx.conf`](./examples/nginx.conf).

## Production Notes

- Run the service on the same host as PM2 for local file access.
- Mount PM2 logs read-only if you use containers.
- Keep `BUFFER_SIZE` realistic for your memory budget.
- Prefer a reverse proxy in front of the service for TLS, rate limiting, and access control.
- Bearer auth on SSE works well for curl and server-to-server consumers. Browser-native `EventSource` cannot send custom `Authorization` headers, so a reverse proxy or another auth strategy may be needed if you later add a browser UI.

## Development

Available scripts:

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run format:check`

## Testing

The test suite covers:

- env validation
- ring buffer bounds
- tail reading of the last `N` lines
- auth middleware
- query validation
- file creation after startup
- append handling
- rotation handling
- SSE delivery via streaming injection

Run:

```bash
npm test
```

## Limitations

- The project is intentionally single-node and local-file based.
- It does not store historical logs beyond the in-memory buffer.
- It does not aggregate across servers.
- It does not provide a browser UI in the current version.
- It uses polling for robustness and simplicity instead of platform-specific file watching.

## Repository Layout

```text
src/
  config/
  logs/
  server/
  types/
  utils/
tests/
examples/
```

## License

MIT. See [`LICENSE`](./LICENSE).
