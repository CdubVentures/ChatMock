# PHASE 7 OF 10 — PIPELINE ORCHESTRATOR, QUEUE MANAGEMENT & 24/7 DAEMON

## ROLE & CONTEXT

You are a senior distributed-systems engineer. Phases 1–6 built every component of the extraction pipeline. This phase **wires them together** into a production-grade orchestrator that can run 24/7, process 15–20 products per day, handle failures gracefully, and maintain detailed operational metrics.

Think of this as building the "factory floor control system." You have the machines (crawler, extractor, validator, identity gate). Now you need the conveyor belt, quality control checkpoints, shift scheduling, and alarm systems.

**Dependencies:** All Phases 1–6 must be complete (field rules, compilation, runtime engine, crawling, extraction, identity gate).

---

## MISSION (NON-NEGOTIABLE)

Build a 24/7, evidence-first "Spec Factory" that can publish 15–20 products per day with ~99% accuracy on expected fields by: (1) strict per-category field contracts, (2) multi-round web + helper-source pipeline with per-field citations, (3) helper artifacts for speed/consistency, (4) Data Review Grid with overrides.

---

## WHAT THIS PHASE DELIVERS

### Deliverable 7A: Product Queue Manager

A persistent queue that:
- Accepts new products from CLI, API, CSV import, or scheduled crawl
- Prioritizes by: new product > stale re-crawl > low-priority gap-fill
- Tracks state per product through the entire pipeline
- Supports batch operations (add 50 products from a list)
- Prevents duplicate processing
- Persists across restarts (JSON file + optional Redis)

### Deliverable 7B: Pipeline Orchestrator

The main controller that:
- Picks products from queue based on priority
- Runs the multi-round pipeline (Phase 4 crawl → Phase 6 identity → Phase 5 extract → Phase 3 validate)
- Enforces per-product budget (time, cost, rounds)
- Handles retries, timeouts, and partial failures
- Manages concurrency (3–4 products in parallel)
- Produces a complete ProductRecord at the end

### Deliverable 7C: 24/7 Daemon

A long-running process that:
- Runs as a system service (systemd) or background process (pm2)
- Continuously processes the queue
- Implements scheduled re-crawl for stale products
- Monitors health (memory, CPU, disk, API quotas)
- Sends alerts on failures (email, Slack webhook, log)
- Graceful shutdown on SIGTERM (finish current product, then exit)

### Deliverable 7D: Operational Dashboard Data

Real-time metrics:
- Products processed today/this week/this month
- Average processing time per product
- Accuracy trends (from golden-file benchmarks)
- LLM cost tracking (per product, per day, per month)
- Source health (success rates, block rates)
- Queue depth and estimated completion time

---

## DETAILED ARCHITECTURE

### Product Queue Schema

```jsonc
// File: data/queue/product_queue.json (or Redis if available)
{
  "queue_version": "1.0.0",
  "updated_at": "2026-02-12T10:00:00Z",
  "entries": [
    {
      "queue_id": "q_001",
      "product_id": "mouse-razer-viper-v3-pro-wireless",
      "category": "mouse",
      "identity": {
        "brand": "Razer",
        "model": "Viper V3 Pro",
        "variant": "Wireless"
      },
      "priority": 1,
      "priority_reason": "new_product",
      "status": "queued",
      "added_at": "2026-02-12T08:00:00Z",
      "added_by": "cli_import",
      "attempts": 0,
      "max_attempts": 3,
      "last_attempt_at": null,
      "last_error": null,
      "scheduled_for": null,
      "tags": ["flagship", "2024-release"],
      "overrides": {}
    }
  ]
}
```

### Queue Status Machine

```
QUEUE STATES:
  queued          → Waiting for processing slot
  in_progress     → Currently being processed
  round_N         → In specific round of pipeline
  awaiting_review → Needs human input (from Identity Gate or confidence too low)
  quarantined    → Evidence audit failed / identity conflict / drift detected (never auto-publish)
  complete        → Successfully processed and output written
  failed          → Failed after max retries
  stale           → Data older than staleness threshold, needs re-crawl
  paused          → Manually paused by operator
  skipped         → Manually skipped (e.g., discontinued product)

PRIORITY LEVELS:
  1 — URGENT:     New flagship product, manually requested
  2 — HIGH:       New product from monitored brand
  3 — NORMAL:     Standard queue entry
  4 — LOW:        Re-crawl for stale data
  5 — BACKGROUND: Optional field gap-filling
```

### Pipeline Orchestrator

```
ORCHESTRATOR MAIN LOOP:

while (running) {
  1. CHECK QUEUE
     - Pick next product by priority (highest priority, oldest first within same priority)
     - Skip products in cooldown (failed recently, waiting for retry delay)
     - Respect concurrency limit (max 3-4 simultaneous products)

  2. INITIALIZE RUN
     - Create run context: { runId, productId, category, startTime, budget }
     - Load field rules for category
     - Load existing evidence pack if re-crawl (incremental mode)
     - Initialize billing ledger for this run

  3. ROUND 0 — IDENTITY FAST CHECK
     - Fetch manufacturer page (1 page)
     - Run Identity Gate verification
     - If identity fails → queue for review, skip to next product
     - If identity confirmed → extract fast specs from this page
     - Update coverage tracker

  4. ROUND 1 — CORE SPECS
     - Plan: which Tier 1+2 sources to crawl
     - Crawl 2-3 sources in parallel
     - For each page: identity verify → extract → validate
     - Merge candidates
     - Update coverage tracker
     - Decision: if all required+critical fields filled → skip to FINALIZE
     
  5. ROUND 2 — DEEP FILL
     - Plan: which additional sources for remaining gaps
     - Crawl 2-3 more sources
     - Extract → validate → merge
     - Update coverage tracker
     - Decision: if coverage ≥ 85% OR budget ≥ 70% used → skip to FINALIZE
     
  6. ROUND 3+ — GAP CLOSURE (optional, budget-dependent)
     - For each unfilled expected field:
       - Is there a plausible source we haven't tried?
       - Is the remaining budget sufficient?
     - Crawl 1-2 targeted sources
     - Decision: stop when coverage gain < 2 fields per round

  7. FINALIZE
     - Run conflict resolution (Phase 5 merger)
     - Run full cross-validation (Phase 3 engine)
     - Run Phase 3 **Evidence Audit** on every non-unk field (snippet_hash + quote_span verification)
     - Compute per-field confidence scores (calibrated)
     - Build unknowns with reason codes for unfilled fields
     - Build final ProductRecord
     - Write to output directory
     - Update queue status → complete

  8. POST-RUN
     - Compute run metrics (time, cost, accuracy vs golden if available)
     - Update operational stats
     - Log run summary
     - Move to next product
}
```

### Concurrency Model

```javascript
// Use p-queue for concurrency control

import PQueue from 'p-queue';

const orchestratorQueue = new PQueue({
  concurrency: 3,            // 3 products simultaneously
  intervalCap: 1,            // 1 new product per interval
  interval: 10000,           // 10 second interval between new products
  timeout: 300000,           // 5 minute timeout per product
  throwOnTimeout: false
});

// Within each product, sources are crawled with their own concurrency
const perProductCrawlQueue = new PQueue({
  concurrency: 2,            // 2 sources simultaneously per product
  interval: 2000,            // 2 seconds between source starts (rate limiting)
});
```

### Budget & Cost Tracking

```jsonc
// Per-run billing ledger
{
  "run_id": "run_20260212_001",
  "product_id": "mouse-razer-viper-v3-pro-wireless",
  "budget": {
    "max_pages": 12,
    "max_llm_calls": 10,
    "max_llm_cost_usd": 0.50,
    "max_wall_clock_s": 300
  },
  "actual": {
    "pages_fetched": 7,
    "llm_calls": {
      "gemini_flash": 4,
      "deepseek": 1,
      "total": 5
    },
    "llm_cost": {
      "gemini_flash_input_tokens": 12000,
      "gemini_flash_output_tokens": 3000,
      "deepseek_input_tokens": 8000,
      "deepseek_output_tokens": 2000,
      "total_usd": 0.087
    },
    "wall_clock_s": 142,
    "rounds_completed": 3
  },
  "budget_utilization": {
    "pages": 0.58,
    "llm_calls": 0.50,
    "cost": 0.17,
    "time": 0.47
  }
}
```

### ProductRecord Output Schema

```jsonc
// The final output for every product — used by publisher and review grid
{
  "product_id": "mouse-razer-viper-v3-pro-wireless",
  "category": "mouse",
  "version": "1.0.0",
  "generated_at": "2026-02-12T10:35:00Z",
  "run_id": "run_20260212_001",
  "identity": {
    "brand": "Razer",
    "model": "Viper V3 Pro",
    "variant": "Wireless",
    "identity_confidence": 0.98,
    "hard_ids": { "sku": "RZ01-04630100-R3A1", "asin": "B0D5CDZBJB" }
  },
  "fields": {
    "weight": {
      "value": 54,
      "confidence": 0.98,
      "provenance": {
        "url": "https://www.razer.com/gaming-mice/razer-viper-v3-pro/specifications",
        "source_id": "razer_com",
        "retrieved_at": "2026-02-12T10:30:15Z",
        "page_content_hash": "sha256:…",
        "snippet_id": "snp_001",
        "snippet_hash": "sha256:…",
        "quote_span": [0, 27],
        "quote": "Weight: 54 g (without cable)",
        "tier": "tier1_manufacturer",
        "extraction_method": "spec_table_match"
      },
      "candidates_count": 3,
      "agreement": "unanimous",
      "cross_validation": { "passed": true, "checks": ["weight_plausibility"] }
    },
    "click_latency": {
      "value": 0.2,
      "confidence": 0.85,
      "provenance": {
        "url": "https://www.rtings.com/mouse/reviews/razer/viper-v3-pro",
        "source_id": "rtings_com",
        "retrieved_at": "2026-02-12T10:31:02Z",
        "page_content_hash": "sha256:…",
        "snippet_id": "snp_010",
        "snippet_hash": "sha256:…",
        "quote_span": [0, 20],
        "quote": "Click Latency: 0.2 ms",
        "tier": "tier2_lab",
        "extraction_method": "llm_extract"
      },
      "candidates_count": 2,
      "agreement": "source_dependent",
      "all_candidates": [
        { "value": 0.2, "source": "rtings.com", "tier": "tier2_lab" },
        { "value": 0.3, "source": "techpowerup.com", "tier": "tier2_lab" }
      ]
    },
    "encoder_brand": {
      "value": "unk",
      "unknown_reason": "not_publicly_disclosed",
      "attempt_trace": {
        "rounds_attempted": 3,
        "sources_checked": ["razer.com", "rtings.com", "techpowerup.com", "overclock.net"],
        "parse_attempts": 2,
        "llm_attempts": 1
      }
    }
    // ... all fields
  },
  "metrics": {
    "total_fields": 154,
    "filled_fields": 128,
    "unknown_fields": 26,
    "coverage": 0.831,
    "avg_confidence": 0.89,
    "fields_needing_review": 8,
    "cross_validation_warnings": 2,
    "processing_time_s": 142,
    "llm_cost_usd": 0.087,
    "sources_used": 5,
    "rounds_completed": 3
  },
  "review_flags": [
    { "field": "click_latency", "reason": "source_dependent — RTINGS vs TechPowerUp disagree" },
    { "field": "encoder_model", "reason": "extracted 'TTC Gold' but not in component_db" }
  ]
}
```

### Daemon Configuration

```jsonc
// config/daemon.json
{
  "daemon": {
    "name": "spec-factory-daemon",
    "pid_file": "/var/run/spec-factory.pid",
    "log_file": "/var/log/spec-factory/daemon.log",
    "concurrency": 3,
    "poll_interval_ms": 5000,
    "graceful_shutdown_timeout_ms": 60000
  },
  "schedule": {
    "re_crawl_stale_after_days": 30,
    "re_crawl_check_cron": "0 2 * * *",
    "daily_report_cron": "0 8 * * *",
    "golden_benchmark_cron": "0 3 * * 0"
  },
  "alerts": {
    "slack_webhook": "${SLACK_WEBHOOK_URL}",
    "email": "${ALERT_EMAIL}",
    "alert_on": ["pipeline_failure", "accuracy_drop", "budget_exceeded", "queue_empty", "source_blocked"]
  },
  "health": {
    "max_memory_mb": 2048,
    "max_cpu_percent": 80,
    "disk_min_free_gb": 5,
    "api_quota_warn_percent": 80
  }
}
```

### CLI Commands

```bash
# Queue management
node src/cli/spec.js queue add --category mouse --brand "Razer" --model "Viper V3 Pro" --variant "Wireless"
node src/cli/spec.js queue add-batch --file products.csv --category mouse
node src/cli/spec.js queue list [--status queued|in_progress|complete|failed]
node src/cli/spec.js queue stats
node src/cli/spec.js queue retry --product-id <id>
node src/cli/spec.js queue pause --product-id <id>
node src/cli/spec.js queue clear --status failed

# Single product run (no queue)
node src/cli/spec.js run --category mouse --brand "Razer" --model "Viper V3 Pro" --variant "Wireless"
node src/cli/spec.js run --category mouse --brand "Razer" --model "Viper V3 Pro" --variant "Wireless" --dry-run

# Daemon management
node src/cli/spec.js daemon start
node src/cli/spec.js daemon stop
node src/cli/spec.js daemon status
node src/cli/spec.js daemon logs [--tail 100]

# Operational metrics
node src/cli/spec.js metrics today
node src/cli/spec.js metrics costs --period week
node src/cli/spec.js metrics accuracy --category mouse
node src/cli/spec.js metrics sources --category mouse
```

---

## OPEN-SOURCE TOOLS & PLUGINS

### Required

| Tool | Purpose | Install |
|------|---------|---------|
| **p-queue** | Promise-based concurrency control | `npm install p-queue` |
| **p-retry** | Retry with exponential backoff | `npm install p-retry` |
| **p-timeout** | Promise timeout wrapper | `npm install p-timeout` |
| **BullMQ** | Redis-backed job queue (production mode) | `npm install bullmq` |
| **ioredis** | Redis client for BullMQ | `npm install ioredis` |
| **node-cron** | Cron scheduling for daemon tasks | `npm install node-cron` |
| **Pino** | Structured JSON logging | `npm install pino pino-pretty` |
| **pm2** | Process manager for daemon mode | `npm install -g pm2` |
| **ms** | Human-readable time durations | `npm install ms` |
| **ora** | CLI spinners for single-run mode | `npm install ora` |
| **cli-table3** | CLI tables for queue/metrics display | `npm install cli-table3` |

### Recommended

| Tool | Purpose | Install |
|------|---------|---------|
| **better-sqlite3** | Local SQLite for run history + metrics | `npm install better-sqlite3` |
| **node-notifier** | Desktop notifications | `npm install node-notifier` |
| **dotenv** | Environment variable management | `npm install dotenv` |
| **conf** | App configuration management | `npm install conf` |

---

## ACCEPTANCE CRITERIA

1. ☐ Queue add/list/retry/pause/clear commands all work
2. ☐ Batch import processes 50 products from CSV
3. ☐ Orchestrator runs multi-round pipeline end-to-end for a single product
4. ☐ Concurrency correctly limits to 3 simultaneous products
5. ☐ Budget enforcement stops processing when limits reached
6. ☐ Failed products retry up to max_attempts with exponential backoff
7. ☐ ProductRecord output matches schema for all 50 golden-file products
8. ☐ Daemon starts, processes queue, and stops gracefully on SIGTERM
9. ☐ Daemon correctly identifies stale products for re-crawl
10. ☐ Metrics command shows accurate throughput (products/day), costs, accuracy
11. ☐ Single-product `run` command works without daemon
12. ☐ Queue persists across daemon restarts (no lost work)
13. ☐ Processing 20 products completes in <8 hours (enough for 15-20/day target)
14. ☐ LLM costs stay under $0.50 per product average
15. ☐ All component phases (crawl → identity → extract → validate) correctly wired together
