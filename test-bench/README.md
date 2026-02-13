# Eval Bench

Lightweight Node.js test bench that proxies requests to ChatMock and renders:

- Raw upstream JSON (`/v1/chat/completions` response)
- Readable table or markdown panel
- Connection dashboard for sidecar configuration reuse
- Async Sidecar Control panel with dedicated `Jobs` and `Replay` tabs

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
- `ASYNC_MAX_IN_FLIGHT` (default `1`)
- `ASYNC_QUEUE_MAX_DEPTH` (default `120`)
- `ASYNC_RETRY_MAX_ATTEMPTS` (default `2`)
- `ASYNC_RETRY_BASE_MS` (default `1500`)
- `ASYNC_RETRY_MAX_DELAY_MS` (default `45000`)
- `ASYNC_AUTH_COOLDOWN_MS` (default `300000`)
- `ASYNC_CHALLENGE_COOLDOWN_MS` (default `90000`)
- `ASYNC_RATE_COOLDOWN_MS` (default `45000`)
- `ASYNC_DEGRADED_COOLDOWN_MS` (default `15000`)

## API routes

- `GET /api/status`: proxy connectivity + copy/paste config snippets
- `GET /api/models`: merged model list (`/v1/models` + fallback)
- `POST /api/test-extract`: extraction test endpoint (multipart form or plain fields)
- `POST /api/queue-test`: runs concurrent requests and reports FIFO/latency results
- `GET /api/traffic`: live proxy traffic feed (captures requests from any client hitting `:8000`)
- `DELETE /api/traffic`: clear traffic feed
- `POST /api/async/submit`: enqueue async sidecar request (`submit/status/result/cancel` contract)
- `GET /api/async/status/:jobId`: job status
- `GET /api/async/result/:jobId`: final envelope (or `202` while pending)
- `POST /api/async/cancel/:jobId`: cancel queued/running job
- `GET /api/async/queue`: queue depth by priority lane
- `GET /api/async/state`: explicit state (`ready/auth_required/challenge/rate_limited/degraded`)
- `GET /api/async/metrics`: observability export (latency, taxonomy, model success, aggressive win-rate, drift alerts)
- `GET /api/async/aggressive/report`: aggressive-trigger and confidence-improvement report
- `GET /api/async/review/:jobId`: Phase-8 style review payload for a completed job
- `POST /api/replay/run`: replay payload set across baseline/candidate model and return field-level deltas
- `GET /api/replay/report/:replayId`: retrieve replay report

The GUI async tabs map directly to these APIs:
- `Jobs`: submit/status/result/cancel/review, plus queue/state/metrics/aggressive refresh
- `Replay`: run replay set and load report by `replay_id`

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

## Canonical env profile

Use `../llm-sidecar.profile.env` as the canonical integration profile for this stack.
