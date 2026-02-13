# PHASE 11 OF 12 — THE CORTEX SIDECAR (CHATMOCK INFRASTRUCTURE)

## ROLE & CONTEXT

You are a senior DevOps and Infrastructure engineer. Phases 1–10 built a robust, automated factory using standard APIs. Phase 11 introduces the **"Cortex Sidecar"** — a local proxy infrastructure that allows the Spec Factory to access "Reasoning" models  via a flat-rate subscription, bypassing the cost and token limits of standard APIs.

This phase does NOT change the extraction logic (that is Phase 12). This phase builds the **machine** that makes "Aggressive Mode" possible: a Dockerized, queued, persistent browser automation service that runs alongside your Orchestrator.

**Dependencies:** Phase 7 (Orchestrator/Daemon) must be complete to integrate the new service.

---

## MISSION (NON-NEGOTIABLE)

Deploy a local "Thinking Engine" that:
1.  **Absorbs Bursts:** Accepts 50+ concurrent requests from the Orchestrator without crashing.
2.  **Manages Time:** Allows models to "think" for 5+ minutes without HTTP timeouts.
3.  **Enables Vision:** Provides the plumbing to send raw images and DOM to the LLM.
4.  **Zero Downtime:** Automatically restarts the browser session if OpenAI errors out.

---

## WHAT THIS PHASE DELIVERS

### Deliverable 11A: The Dockerized ChatMock Service
A customized fork of ChatMock wrapped in Docker Compose:
- **Service:** `cortex-proxy` running on port 8000.
- **Volume:** Persists `/app/auth` so login sessions survive restarts.
- **Network:** internal-only connection to the Spec Harvester container.

### Deliverable 11B: The Concurrency Queue (FIFO)
A Python-based threading overhaul of the ChatMock server:
- **Input:** Flask route accepts request → pushes to `JobQueue`.
- **Worker:** Single background thread pulls Job → runs Playwright → returns Result.
- **Safety:** Limits browser tabs to 1 (to prevent detection/bans).

### Deliverable 11C: The Node.js "Cortex Client" Adapter
A drop-in replacement for your current LLM client (`src/llm/cortex_client.js`) that:
- Handles the custom API payload (images + text).
- Sets a **10-minute timeout** (vs standard 60s).
- Implements "Long Polling" or "Job ID" checks to wait for reasoning results.

---

## ACCEPTANCE CRITERIA

1. ☐ `docker-compose up` launches `cortex-proxy` and successfully logs into ChatGPT (headless or headed).
2. ☐ The Queue accepts 20 simultaneous requests and processes them sequentially without error.
3. ☐ Clipboard Injection is implemented: 5,000 chars of text paste in <1 second.
4. ☐ "Thinking" Detection works: The proxy waits until the specific reasoning animation stops before capturing text.
5. ☐ Auto-Recovery: If the browser crashes, the service detects it and restarts the context within 15 seconds.
6. ☐ The `cortex_client.js` can successfully send a "Hello World" to the proxy and get a response in Node.js.
7. ☐ Authentication volume works: Restarting the container does NOT require re-scanning the QR code/login.
8. ☐ Resource Blocking is active: Fonts/Ads are blocked in Playwright to speed up page loads.
9. ☐ "Headed Mode" toggle works via environment variable `DEBUG_SHOW_BROWSER=true`.
10. ☐ System resource usage (RAM/CPU) is stable after 1 hour of idle time.