# Eval Bench

Lightweight Node.js test bench that proxies requests to ChatMock and renders:

- Raw upstream JSON (`/v1/chat/completions` response)
- Readable table or markdown panel
- Connection dashboard for sidecar configuration reuse

## Run locally without Docker

```bash
npm install
npm start
```

Environment variables:

- `PORT` (default `4000`)
- `CHATMOCK_BASE_URL` (default `http://chatmock:8000`)
- `CHATMOCK_TIMEOUT_MS` (default `900000`, use `0` for no timeout)
- `CHATMOCK_API_KEY` (default `key`)

## API routes

- `GET /api/status`: proxy connectivity + copy/paste config snippets
- `GET /api/models`: merged model list (`/v1/models` + fallback)
- `POST /api/test-extract`: extraction test endpoint (multipart form or plain fields)
- `POST /api/queue-test`: runs concurrent requests and reports FIFO/latency results
- `GET /api/traffic`: live proxy traffic feed (captures requests from any client hitting `:8000`)
- `DELETE /api/traffic`: clear traffic feed

`/api/test-extract` accepted fields:

- `model` (string)
- `inputText` (string)
- `aggressiveMode` (`true|false`)
- `timeoutMs` (optional override)
- `imageFile` (optional image upload)

## Reusable API Client

`src/services/chatmockClient.js` is intentionally isolated so you can copy only that file (and `src/config.js` if desired) into another project.

Main methods:

- `chatCompletions(payload, overrideTimeoutMs?)`
- `listModels()`
- `health()`
