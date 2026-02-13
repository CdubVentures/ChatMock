# PHASE 4 OF 10 — MULTI-ROUND WEB CRAWLING & EVIDENCE COLLECTION PIPELINE

## ROLE & CONTEXT

You are a senior data-pipeline engineer specializing in web scraping at scale. Phases 1–3 built the field rules, compilation, and runtime engine. This phase builds the **multi-round crawling and evidence collection pipeline** — the system that goes out to the web, fetches pages, extracts raw content, and packages it as an **EvidencePack** that downstream extractors can work with.

This is the "data acquisition" layer. It does NOT extract field values (that's Phase 5). It collects raw evidence: HTML pages, spec tables, API responses, and packages them with metadata. The philosophy is **crawl once, extract many** — evidence is cached and reusable.

**Accuracy note:** evidence must be *stable and verifiable*. Every snippet should carry a hash and (optionally) a screenshot crop so downstream phases can prove “this value came from exactly this text on exactly this page version.”

**Dependencies:** Phase 3 (FieldRulesEngine) must be complete. The engine tells this phase which fields to prioritize, which sources to prefer, and how much effort to spend.

---

## MISSION (NON-NEGOTIABLE)

Build a 24/7, evidence-first "Spec Factory" that can publish 15–20 products per day with ~99% accuracy on expected fields by: (1) strict per-category field contracts, (2) multi-round web + helper-source pipeline with per-field citations, (3) helper artifacts for speed/consistency, (4) Data Review Grid with overrides.

---

## WHAT THIS PHASE DELIVERS

### Deliverable 4A: Source Registry & Tier System

A configurable, per-category registry of sources with:
- Tiered source hierarchy (manufacturer → lab → retailer → community → aggregator)
- Per-source crawl configuration (rate limits, selectors, robots.txt compliance)
- Per-source field coverage maps (which fields this source typically provides)
- Health monitoring (uptime, block rate, content freshness)

### Deliverable 4B: Multi-Round Orchestrator

An effort-budgeted orchestrator that:
- Plans crawl rounds based on field_rules effort/difficulty metadata
- Tracks field coverage after each round
- Decides whether to continue or stop based on diminishing returns
- Manages concurrency (3–4 products in parallel, sequential sources per product)

### Deliverable 4C: Crawling Engine

A production-grade crawling layer with:
- Playwright for JavaScript-rendered pages (spec tables, lazy-loaded content)
- Cheerio/Trafilatura for fast static page extraction
- API fetchers for structured data sources (RTINGS API, TechPowerUp API, price APIs)
- Proxy rotation, stealth fingerprinting, retry logic
- robots.txt compliance and rate limiting

### Deliverable 4D: EvidencePack Builder

A standardized evidence packaging system that:
- Assigns unique snippet_ids to every piece of extracted content
- Preserves raw HTML + cleaned text for every page
- Indexes content by source, field relevance, and extraction method
- Stores as local JSON + optional S3 mirror

---

## DETAILED ARCHITECTURE

### Source Tier System

```
TIER 1 — MANUFACTURER (highest authority for specs)
  Priority: 1 (always crawl first)
  Examples: razer.com/*/specs, logitech.com/*/product, steelseries.com/*/specs
  Trust: Authoritative for physical specs, connectivity, official features
  Weakness: May omit lab-measured data (latency), may use marketing language
  Crawl method: Playwright (many use JS-rendered spec tables)

TIER 2 — INDEPENDENT LAB (highest authority for measured data)
  Priority: 2 (crawl second)
  Examples: rtings.com, techpowerup.com, tom'shardware.com
  Trust: Gold standard for latency, sensor accuracy, weight verification
  Weakness: Don't cover all products; may take weeks to publish
  Crawl method: Mixed (RTINGS needs Playwright; TPU is mostly static)
  Special: Some offer structured APIs or JSON endpoints

TIER 3 — MAJOR RETAILER (good for price, availability, basic specs)
  Priority: 3
  Examples: amazon.com, bestbuy.com, newegg.com, bhphotovideo.com
  Trust: Good for price, availability, basic specs; often copy manufacturer data
  Weakness: User-contributed specs may be wrong; descriptions are marketing
  Crawl method: API preferred (Amazon Product API, BestBuy API); Playwright fallback
  Note: Some have product data APIs — prefer API over scraping

TIER 4 — COMMUNITY & ENTHUSIAST (good for niche data)
  Priority: 4
  Examples: reddit.com, overclock.net forums, geekhack.org
  Trust: Can reveal undisclosed specs (teardowns, firmware analysis)
  Weakness: Unverified; anecdotal; may conflict with official data
  Crawl method: API (Reddit API, cached forum pages)
  Use: Only for hard/rare fields after Tier 1–3 exhausted

TIER 5 — AGGREGATOR (lowest authority)
  Priority: 5
  Examples: pcpartpicker.com, pangoly.com, versus.com, nerdtechy.com
  Trust: May have useful structured data but is often scraped from other sources
  Weakness: No original data; may be outdated; circular sourcing
  Crawl method: Cheerio (mostly static structured data)
  Use: Gap-filling only; cross-reference required
```

### Source Registry Schema (per category)

```jsonc
// categories/<category>/sources.json
{
  "category": "mouse",
  "version": "1.0.0",
  "sources": {
    "razer_com": {
      "display_name": "Razer Official",
      "tier": "tier1_manufacturer",
      "base_url": "https://www.razer.com",
      "brand_filter": ["Razer"],
      "crawl_config": {
        "method": "playwright",
        "wait_for": ".specs-table, [data-testid='product-specs']",
        "timeout_ms": 15000,
        "rate_limit_ms": 2000,
        "stealth": true,
        "user_agent_rotate": true,
        "max_retries": 3,
        "robots_txt_compliant": true
      },
      "url_templates": [
        "https://www.razer.com/{model_slug}",
        "https://www.razer.com/gaming-mice/{model_slug}/specifications"
      ],
      "content_selectors": {
        "spec_table": ".specs-section table, .product-specs table",
        "main_content": ".product-description, .product-overview",
        "price": "[data-testid='product-price'], .price-current"
      },
      "field_coverage": {
        "high": ["weight", "sensor", "dpi", "polling_rate", "connection", "switches", "battery_hours", "dimensions"],
        "medium": ["coating", "cable_type", "feet_type", "rgb"],
        "low": ["click_latency", "sensor_latency"]
      },
      "health": {
        "last_checked": "2026-02-12T00:00:00Z",
        "success_rate": 0.92,
        "avg_response_ms": 3200,
        "block_rate": 0.05
      }
    },
    "rtings_com": {
      "display_name": "RTINGS",
      "tier": "tier2_lab",
      "base_url": "https://www.rtings.com",
      "brand_filter": null,
      "crawl_config": {
        "method": "playwright",
        "wait_for": ".scores_table, .test-results",
        "timeout_ms": 20000,
        "rate_limit_ms": 3000,
        "stealth": true,
        "max_retries": 2,
        "robots_txt_compliant": true
      },
      "url_templates": [
        "https://www.rtings.com/mouse/reviews/{brand_lower}/{model_slug}",
        "https://www.rtings.com/mouse/1-5-0/{brand_lower}-{model_slug}/review"
      ],
      "api_endpoint": {
        "enabled": true,
        "base": "https://www.rtings.com/api/v2",
        "product_search": "/products?type=mouse&query={brand}+{model}",
        "product_detail": "/products/{rtings_id}/scores",
        "rate_limit_ms": 5000,
        "auth": null
      },
      "content_selectors": {
        "spec_table": ".specs_table, .test-results-table",
        "scores": ".scores_table td",
        "main_content": ".review-body"
      },
      "field_coverage": {
        "high": ["click_latency", "sensor_latency", "weight", "polling_rate", "dpi", "lift_off_distance"],
        "medium": ["cable_type", "feet_type", "connection"],
        "low": ["switch", "encoder"]
      }
    },
    "techpowerup_com": {
      "display_name": "TechPowerUp",
      "tier": "tier2_lab",
      "base_url": "https://www.techpowerup.com",
      "crawl_config": {
        "method": "cheerio",
        "timeout_ms": 10000,
        "rate_limit_ms": 2000,
        "max_retries": 3,
        "robots_txt_compliant": true
      },
      "url_templates": [
        "https://www.techpowerup.com/review/{brand_lower}-{model_slug}/"
      ],
      "content_selectors": {
        "spec_table": "table.specs, .review-specs table",
        "main_content": ".review-body"
      },
      "field_coverage": {
        "high": ["weight", "sensor", "dpi", "polling_rate", "switches", "dimensions"],
        "medium": ["click_latency", "sensor_latency", "feet_type", "cable_type"],
        "low": ["encoder", "mcu"]
      }
    }
    // ... more sources per category
  }
}
```

---

### Multi-Round Orchestrator

```
ROUND 0 — IDENTITY & FAST FACTS (1–3 sources, ~30 seconds)
  Purpose: Confirm product identity + grab easy specs from manufacturer
  Sources: Manufacturer page only
  Fields targeted: identity group + physical group + sensor/switch if on spec table
  Budget: effort ≤ 3 per field
  Stop condition: Identity confirmed (brand + model + variant match 1+ source)
  Concurrency: 1 page
  LLM calls: 0–1 (identity confirmation only if ambiguous)

ROUND 1 — CORE SPECS (2–4 sources, ~60–120 seconds)
  Purpose: Fill all required + critical fields
  Sources: Manufacturer + Top Tier 2 (RTINGS, TechPowerUp)
  Fields targeted: All required + critical fields still missing
  Budget: effort ≤ 5 per field
  Stop condition: All required fields filled OR all Tier 1–2 sources exhausted
  Concurrency: 2–3 pages (different sources in parallel)
  LLM calls: 1–3 (structured extraction from spec tables)

ROUND 2 — DEEP MANUFACTURER + LAB (2–3 additional sources, ~60–120 seconds)
  Purpose: Fill expected fields, verify critical fields
  Sources: Secondary Tier 2 + Tier 3 (BestBuy, Amazon for verification)
  Fields targeted: expected fields + cross-validation of critical fields
  Budget: effort ≤ 7 per field
  Stop condition: Coverage ≥ 85% of expected fields OR budget exhausted
  Concurrency: 2 pages
  LLM calls: 2–4

ROUND 3+ — GAP CLOSURE (1–3 sources, ~60 seconds each)
  Purpose: Fill remaining optional fields, resolve conflicts
  Sources: Tier 3–5 as needed
  Fields targeted: Any unfilled field with effort ≤ remaining budget
  Budget: effort ≤ 10 per field (diminishing returns threshold)
  Stop conditions:
    - Coverage ≥ 90% of all expected fields, OR
    - No new sources available for unfilled fields, OR
    - Per-product budget exhausted ($0.50 LLM cost limit), OR
    - 3 consecutive rounds with <2 new fields filled
  Concurrency: 1 page (caution mode)
  LLM calls: 1–2

FINAL — CONFLICT RESOLUTION & PACKAGING (~10–30 seconds)
  Purpose: Resolve multi-source conflicts, build final record
  No new crawling — only processes existing EvidencePack
  Steps:
    1. For each field with multiple candidates from different sources:
       a. Apply source priority (tier1 > tier2 > tier3...)
       b. If same tier disagrees: prefer by field-specific evidence_tier_preference
       c. If still ambiguous: flag for human review (confidence < 0.8)
       d. If within tolerance (e.g., weight ±2g): take manufacturer value
    2. Run cross-validation (Phase 3 engine)
    3. Build final normalized record
    4. Package unknowns with reason codes
    5. Compute per-field confidence scores
```

#### Effort Budget System

```jsonc
// Each product gets a total effort budget
{
  "per_product_budget": {
    "max_rounds": 5,
    "max_sources": 8,
    "max_pages": 12,
    "max_llm_calls": 10,
    "max_llm_cost_usd": 0.50,
    "max_wall_clock_seconds": 300,
    "max_retries_per_source": 3
  },
  // Per-round budgets (subset of product budget)
  "round_budgets": {
    "0": { "max_sources": 1, "max_pages": 2, "max_llm_calls": 1, "timeout_s": 30 },
    "1": { "max_sources": 3, "max_pages": 4, "max_llm_calls": 3, "timeout_s": 120 },
    "2": { "max_sources": 3, "max_pages": 3, "max_llm_calls": 3, "timeout_s": 120 },
    "3+": { "max_sources": 2, "max_pages": 2, "max_llm_calls": 2, "timeout_s": 60 }
  }
}
```

#### Orchestrator State Machine

```
STATES:
  QUEUED → product in pipeline, waiting for slot
  ROUND_N_PLANNING → deciding which sources/fields for this round
  ROUND_N_CRAWLING → fetching pages
  ROUND_N_EXTRACTING → LLM/parser extraction (Phase 5)
  ROUND_N_VALIDATING → running through FieldRulesEngine
  ROUND_N_COMPLETE → round done, deciding next action
  CONFLICT_RESOLUTION → resolving multi-source disagreements
  HUMAN_REVIEW_PENDING → waiting for human input (confidence < threshold)
  COMPLETE → all rounds done, record finalized
  FAILED → unrecoverable error
  STALE → re-crawl needed (data too old)

TRANSITIONS:
  QUEUED → ROUND_0_PLANNING (slot available)
  ROUND_N_PLANNING → ROUND_N_CRAWLING (plan ready)
  ROUND_N_CRAWLING → ROUND_N_EXTRACTING (pages fetched)
  ROUND_N_EXTRACTING → ROUND_N_VALIDATING (extraction done)
  ROUND_N_VALIDATING → ROUND_N_COMPLETE (validation done)
  ROUND_N_COMPLETE → ROUND_{N+1}_PLANNING (more rounds needed)
  ROUND_N_COMPLETE → CONFLICT_RESOLUTION (all rounds done)
  CONFLICT_RESOLUTION → HUMAN_REVIEW_PENDING (confidence too low)
  CONFLICT_RESOLUTION → COMPLETE (all resolved)
  HUMAN_REVIEW_PENDING → COMPLETE (human approved)
  ANY → FAILED (unrecoverable error after retries)
```

---

### Crawling Engine

#### File: `src/crawl/crawler.js`

```
CRAWLER ARCHITECTURE:

┌──────────────────────────────────────────────────────┐
│                  CrawlManager                         │
│  - manages browser pool (Playwright)                  │
│  - manages HTTP client pool (fetch/got)               │
│  - enforces rate limits per domain                    │
│  - routes requests to appropriate engine              │
└────────┬──────────────┬──────────────┬───────────────┘
         │              │              │
    ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
    │Playwright│   │ Cheerio │   │  API    │
    │ Engine   │   │ Engine  │   │ Engine  │
    │(dynamic) │   │(static) │   │(struct) │
    └────┬────┘   └────┬────┘   └────┬────┘
         │              │              │
    ┌────▼──────────────▼──────────────▼───┐
    │         Content Processor             │
    │  - Trafilatura (main content extract) │
    │  - Readability (fallback)             │
    │  - Table extractor (spec tables)      │
    │  - JSON-LD extractor (structured)     │
    └────────────────┬─────────────────────┘
                     │
    ┌────────────────▼─────────────────────┐
    │         EvidencePack Builder          │
    │  - Assigns snippet_ids               │
    │  - Indexes by field relevance        │
    │  - Stores raw + clean content        │
    └──────────────────────────────────────┘
```

#### Playwright Engine (for JS-rendered pages)

```javascript
// Key configuration for stealth crawling
const playwrightConfig = {
  browser: 'chromium',
  headless: true,
  plugins: [
    'playwright-extra',           // Plugin framework
    'puppeteer-extra-plugin-stealth'  // Anti-detection
  ],
  contextOptions: {
    viewport: { width: 1920, height: 1080 },
    userAgent: rotateUserAgent(),   // Rotate from pool of 50+ real UAs
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: null,
    permissions: [],
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1'
    }
  },
  navigation: {
    waitUntil: 'networkidle',
    timeout: 15000
  },
  // Block unnecessary resources for speed
  routeBlock: ['image', 'font', 'media', 'stylesheet'],
  // Wait for spec tables to render
  waitForSelectors: {
    timeout: 10000,
    selectors: [] // Populated from source registry
  }
};
```

#### Cheerio Engine (for static pages — 5–10× faster)

```javascript
// Use for sources where content is in initial HTML
// No JS rendering needed = much faster

const cheerioConfig = {
  httpClient: 'got',  // or node-fetch
  timeout: 10000,
  retries: 3,
  headers: {
    'User-Agent': rotateUserAgent(),
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9'
  }
};

// Table extraction with Cheerio
function extractSpecTables(html, selectors) {
  const $ = cheerio.load(html);
  const tables = [];
  $(selectors.spec_table).each((i, table) => {
    const rows = [];
    $(table).find('tr').each((j, tr) => {
      const cells = [];
      $(tr).find('td, th').each((k, cell) => {
        cells.push($(cell).text().trim());
      });
      if (cells.length >= 2) rows.push(cells);
    });
    tables.push({ index: i, rows, selector: selectors.spec_table });
  });
  return tables;
}
```

#### API Engine (for structured data sources)

```javascript
// Some sources expose APIs or structured data
// ALWAYS prefer API over scraping when available

const apiSources = {
  rtings: {
    search: 'https://www.rtings.com/api/v2/products?type={category}&query={query}',
    detail: 'https://www.rtings.com/api/v2/products/{id}/scores',
    rateLimit: 5000  // ms between calls
  },
  bestbuy: {
    search: 'https://api.bestbuy.com/v1/products(search={query})?format=json&apiKey={key}',
    rateLimit: 1000
  },
  pcpartpicker: {
    // Structured HTML with consistent selectors
    specTable: '.specs-table'
  }
};

// JSON-LD extraction (many sites embed structured data)
function extractJsonLd(html) {
  const $ = cheerio.load(html);
  const jsonLd = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const data = JSON.parse($(el).html());
      if (data['@type'] === 'Product') {
        jsonLd.push(data);
      }
    } catch (e) { /* skip malformed */ }
  });
  return jsonLd;
}

// IMPORTANT (accuracy + provenance):
// Convert each JSON-LD Product object into a first-class snippet so downstream phases can cite it
// just like spec-table rows and test results.
//   snippet.type = "json_ld_product"
//   snippet.text = JSON.stringify(product)
//   snippet.normalized_text = whitespaceCollapse(snippet.text)
//   snippet.snippet_hash = sha256(snippet.normalized_text)
```


---

### EvidencePack Schema

```jsonc
{
  "product_id": "mouse-razer-viper-v3-pro",
  "category": "mouse",
  "created_at": "2026-02-12T10:30:00Z",
  "updated_at": "2026-02-12T10:35:00Z",
  "evidence_pack_version": "1.1.0",
  "schema_version": "2026-02-13",
  "content_language": "en",
  "rounds_completed": 3,
  "sources_crawled": 5,
  "total_snippets": 47,
  "budget_used": {
    "pages_fetched": 7,
    "llm_calls": 4,
    "llm_cost_usd": 0.12,
    "wall_clock_seconds": 187
  },
  "sources": {
    "razer_com": {
      "tier": "tier1_manufacturer",
      "url": "https://www.razer.com/gaming-mice/razer-viper-v3-pro/specifications",
      "fetched_at": "2026-02-12T10:30:15Z",
      "status": 200,
      "method": "playwright",
      "normalized_url": "https://www.razer.com/gaming-mice/razer-viper-v3-pro/specifications",
      "page_content_hash": "sha256:…",
      "text_hash": "sha256:…",
      "raw_html_path": "evidence/mouse-razer-viper-v3-pro/razer_com.html",
      "cleaned_text_path": "evidence/mouse-razer-viper-v3-pro/razer_com.txt",
      "screenshot_path": "evidence/mouse-razer-viper-v3-pro/razer_com.png",
      "snippets": ["snp_001", "snp_002", "snp_003", "..."]
    },
    "rtings_com": {
      "tier": "tier2_lab",
      "url": "https://www.rtings.com/mouse/reviews/razer/viper-v3-pro",
      "fetched_at": "2026-02-12T10:31:02Z",
      "status": 200,
      "method": "playwright",
      "normalized_url": "https://www.rtings.com/mouse/reviews/razer/viper-v3-pro",
      "page_content_hash": "sha256:…",
      "text_hash": "sha256:…",
      "snippets": ["snp_010", "snp_011", "..."]
    }
    // ... more sources
  },
  "snippets": {
    "snp_001": {
      "source": "razer_com",
      "type": "spec_table_row",
      "field_hints": ["weight"],
      "key": "Weight",
      "value": "54 g (without cable)",
      "cells": ["Weight", "54 g (without cable)"],
      "text": "Weight: 54 g (without cable)",
      "normalized_text": "Weight: 54 g (without cable)",
      "snippet_hash": "sha256:…",
      "html": "<tr><td>Weight</td><td>54 g (without cable)</td></tr>",
      "location": {
        "selector": ".specs-table tr:nth-child(3)",
        "bounding_box": { "x": 0, "y": 0, "w": 0, "h": 0 },
        "screenshot_crop_path": "evidence/mouse-razer-viper-v3-pro/crops/snp_001.png",
        "char_offset": 1234,
        "surrounding_context": "...Dimensions: 127.1 x 63.9 x 39.8mm | Weight: 54 g (without cable) | Cable Type: Speedflex..."
      }
    },
    "snp_010": {
      "source": "rtings_com",
      "type": "test_result",
      "field_hints": ["click_latency"],
      "text": "Click Latency: 0.2 ms",
      "normalized_text": "Click Latency: 0.2 ms",
      "snippet_hash": "sha256:…",
      "html": "<td class='score'>0.2 ms</td>",
      "location": { "selector": ".test-results tr.click-latency td.score" }
    }
    // ... all snippets
  }
}
```

---

### Content Processing Pipeline

```
RAW HTML → PROCESSING PIPELINE:

1. TRAFILATURA (main content extraction)
   - Input: raw HTML
   - Output: clean article text (strips nav, ads, footer, sidebar)
   - Reduces token count by 60–80%
   - npm: spawn Python subprocess OR use trafilatura-js port
   
2. CHEERIO TABLE EXTRACTION
   - Input: raw HTML
   - Output: structured table data [{key: "Weight", value: "54 g"}, ...]
   - Targets spec tables specifically via source-defined selectors
   - Falls back to generic table detection

3. JSON-LD EXTRACTION
   - Input: raw HTML
   - Output: Product schema.org data
   - Many manufacturer sites embed structured product data

4. READABILITY (fallback)
   - Input: raw HTML (when Trafilatura fails)
   - Output: simplified article content
   - npm: @mozilla/readability

5. SNIPPET INDEXER
   - Input: all extracted content
   - Output: snippet index with unique IDs
   - Stores BOTH raw text (`text`) and canonical whitespace-collapsed text (`normalized_text`)
   - Computes `snippet_hash = sha256(normalized_text)` for drift detection and evidence verification
   - Assigns field_hints based on keyword matching (from parse_context_keywords)
   - Computes relevance scores per snippet per field
   - (Playwright) optionally stores a per-snippet screenshot crop + bounding box to support pixel-perfect review highlighting
```

---

## OPEN-SOURCE TOOLS & PLUGINS

### Required

| Tool | Purpose | Install |
|------|---------|---------|
| **Playwright** | Browser automation for JS-rendered pages | `npm install playwright` |
| **playwright-extra** | Plugin system for Playwright | `npm install playwright-extra` |
| **puppeteer-extra-plugin-stealth** | Anti-detection for headless browsers | `npm install puppeteer-extra-plugin-stealth` |
| **Cheerio** | Fast HTML parsing for static pages | `npm install cheerio` |
| **got** | HTTP client with retry/redirect support | `npm install got` |
| **Trafilatura** | Main content extraction (Python, via subprocess) | `pip install trafilatura --break-system-packages` |
| **@mozilla/readability** | Fallback content extraction | `npm install @mozilla/readability` |
| **jsdom** | DOM implementation for Readability | `npm install jsdom` |
| **p-queue** | Promise-based queue with concurrency control | `npm install p-queue` |
| **p-retry** | Retry with exponential backoff | `npm install p-retry` |
| **robots-parser** | Parse robots.txt for compliance | `npm install robots-parser` |
| **user-agents** | Realistic user-agent rotation | `npm install user-agents` |
| **BullMQ** | Redis-backed job queue for production | `npm install bullmq` |

### Recommended

| Tool | Purpose | Install |
|------|---------|---------|
| **Crawlee** | Production crawling framework (alt to DIY) | `npm install crawlee` |
| **proxy-chain** | Proxy rotation management | `npm install proxy-chain` |
| **tough-cookie** | Cookie jar management | `npm install tough-cookie` |
| **html-to-text** | HTML→text conversion | `npm install html-to-text` |
| **Pino** | Structured JSON logging | `npm install pino pino-pretty` |

---

## LLM INTEGRATION POINTS (for this phase)

This phase has **minimal LLM usage** — crawling is primarily deterministic. LLMs are used only for:

1. **URL Discovery** (Gemini Flash — cheap, fast):
   - Given brand + model, generate likely URL slugs
   - "What would the Razer Viper V3 Pro product page URL look like?"
   - Use Gemini 2.0 Flash for this — it's a simple reasoning task

2. **Content Relevance Scoring** (Gemini Flash):
   - Given a page's text, is this the right product page?
   - Identity confirmation: "Does this page describe the Razer Viper V3 Pro?"
   - Use Gemini Flash — binary classification, cheap

3. **Search Query Generation** (DeepSeek Reasoning):
   - When direct URL templates fail, generate Google/Bing search queries
   - "Generate 3 search queries to find the official spec page for {brand} {model}"
   - Use DeepSeek for reasoning about query strategy

**NO LLM extraction in this phase** — that's Phase 5.

---

## ACCEPTANCE CRITERIA

1. ☐ Source registry defined for `mouse` category with ≥5 sources across all tiers
2. ☐ Playwright engine successfully crawls manufacturer spec pages (Razer, Logitech, SteelSeries)
3. ☐ Cheerio engine successfully extracts spec tables from static pages (TechPowerUp)
4. ☐ Trafilatura integration reduces content by ≥60% while preserving spec data
5. ☐ EvidencePack produced for a test product with all snippet_ids assigned
6. ☐ robots.txt compliance verified for all registered sources
7. ☐ Rate limiting enforced per source domain
8. ☐ Stealth mode passes basic headless detection tests
9. ☐ Orchestrator correctly executes Round 0 → Round 1 → Round 2 sequence
10. ☐ Orchestrator stops when budget exhausted (respects max_llm_calls, max_pages, timeout)
11. ☐ JSON-LD extraction captures Product schema from manufacturer sites
12. ☐ Spec table extraction produces structured key-value pairs
13. ☐ Content relevance scoring correctly identifies right vs wrong product pages
14. ☐ EvidencePack stored locally with S3 mirror option
15. ☐ End-to-end: given "Razer Viper V3 Pro", produce complete EvidencePack in <5 minutes

---

## WHAT PHASE 5 EXPECTS

Phase 5 (LLM-Powered Field Extraction) will:
- Receive the EvidencePack as input
- Use parse_templates for deterministic extraction first
- Use LLM extraction for remaining fields
- Need snippet_ids for every extracted value
- Need cleaned text (not raw HTML) for LLM context

Phase 5 REQUIRES:
- Complete EvidencePack with snippet index
- Cleaned text versions of all pages (via Trafilatura)
- Structured spec table data (via Cheerio)
- Source tier metadata for priority resolution
