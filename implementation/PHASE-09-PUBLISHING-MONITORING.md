# PHASE 9 OF 10 — PUBLISHING PIPELINE, OUTPUT FORMATS & CONTINUOUS ACCURACY MONITORING

## ROLE & CONTEXT

You are a senior data-platform engineer building the output layer of a production data pipeline. Phases 1–8 built everything from field rules through extraction, orchestration, and human review. This phase builds the **publishing pipeline** — the system that transforms reviewed ProductRecords into clean, normalized output in multiple formats and continuously monitors accuracy.

This is where data leaves the Spec Factory and enters the real world: websites, APIs, spreadsheets, databases, comparison tools. Every output must be traceable back to its evidence. Every published value must have passed through the FieldRulesEngine and human review. This phase also builds the **accuracy monitoring system** that ensures the 99% target is maintained over time.

**Dependencies:** Phase 7 (ProductRecord) + Phase 8 (Review Grid overrides) must be complete.

---

## MISSION (NON-NEGOTIABLE)

Build a 24/7, evidence-first "Spec Factory" that can publish 15–20 products per day with ~99% accuracy on expected fields by: (1) strict per-category field contracts, (2) multi-round web + helper-source pipeline with per-field citations, (3) helper artifacts for speed/consistency, (4) Data Review Grid with overrides.

---

## WHAT THIS PHASE DELIVERS

### Deliverable 9A: Publishing Pipeline

A multi-format output system that:
- Merges ProductRecord + Overrides into a final published record
- Outputs to multiple formats: JSON, Excel, CSV, SQLite, API-ready JSON, Markdown
- Applies final normalization and formatting per output format
- Generates diff reports (what changed since last publish)
- Supports incremental publishing (only changed products)
- Archives previous versions for audit trail

### Deliverable 9B: Output Formats

```
OUTPUT FORMAT MATRIX:

┌─────────────────┬────────────────────────────────────────────────────┐
│ Format          │ Use Case                                          │
├─────────────────┼────────────────────────────────────────────────────┤
│ JSON (full)     │ API consumption, front-end rendering, internal    │
│ JSON (compact)  │ Lightweight API responses, mobile apps (lists stay arrays) │
│ Excel (.xlsx)   │ Human review, sharing, manual analysis            │
│ CSV             │ Data import, spreadsheet tools, flat file exchange│
│ SQLite          │ Local queryable database, analytics               │
│ Markdown        │ Documentation, changelog, product pages           │
│ HTML (table)    │ Static product pages, comparison tables           │
│ JSON-LD         │ SEO structured data (schema.org Product)          │
│ RSS/Atom        │ New product feed                                  │
└─────────────────┴────────────────────────────────────────────────────┘
```

### Deliverable 9C: Accuracy Monitoring Dashboard

A continuous monitoring system that:
- Runs golden-file benchmarks on schedule (weekly)
- Tracks per-field accuracy over time
- Detects regressions (field accuracy drops)
- Alerts on accuracy below threshold
- Generates visual reports (charts, tables)
- Compares accuracy across categories

### Deliverable 9D: Audit Trail & Provenance Export

A complete lineage system that:
- For ANY published value, traces back to: source URL → snippet → extraction method → validation → review
- Exports provenance reports per product
- Maintains version history (every publish is a version)
- Supports "why is this value X?" queries

---

## DETAILED IMPLEMENTATION

### Publishing Pipeline Flow

```
ProductRecord (Phase 7)
     +
Overrides (Phase 8)
     │
     ▼
┌─────────────────────────────────────────────────┐
│  STAGE 1: MERGE                                  │
│  - Apply overrides on top of ProductRecord       │
│  - Override wins for any field with an override   │
│  - Log merge decisions                            │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  STAGE 2: FINAL VALIDATION                       │
│  - Re-run FieldRulesEngine on merged record      │
│  - Verify all evidence citations still valid (snippet_id exists, snippet_hash matches, quote_span slices correctly)      │
│  - Check required fields are filled              │
│  - Flag any new issues                           │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  STAGE 3: FORMAT TRANSFORM                       │
│  - Generate each requested output format         │
│  - Apply format-specific normalization           │
│  - Excel: proper column widths, conditional fmt  │
│  - JSON-LD: schema.org Product mapping           │
│  - Markdown: table formatting                    │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  STAGE 4: DIFF & VERSION                         │
│  - Compare against previous published version    │
│  - Generate changelog (fields changed)           │
│  - Increment version number                      │
│  - Archive previous version                      │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  STAGE 5: WRITE & DISTRIBUTE                     │
│  - Write to output directory                     │
│  - Copy to S3 if OUTPUT_MODE=dual                │
│  - Update category index                         │
│  - Trigger webhooks if configured                │
│  - Update accuracy metrics                       │
└─────────────────────────────────────────────────┘
```

### Output Directory Structure

```
output/
├── <category>/
│   ├── _index.json                    # Category-level index
│   ├── _changelog.json                # Recent changes across products
│   ├── _accuracy_report.json          # Latest accuracy metrics
│   ├── published/
│   │   ├── <product_id>/
│   │   │   ├── current.json           # Latest published full JSON
│   │   │   ├── compact.json           # Lightweight version
│   │   │   ├── provenance.json        # Full evidence trail
│   │   │   ├── changelog.json         # Version history
│   │   │   └── versions/
│   │   │       ├── v1.0.0.json
│   │   │       ├── v1.1.0.json
│   │   │       └── ...
│   │   └── ...
│   ├── exports/
│   │   ├── all_products.xlsx          # Complete Excel workbook
│   │   ├── all_products.csv           # Flat CSV
│   │   ├── all_products.sqlite        # SQLite database
│   │   ├── comparison_table.html      # Product comparison HTML
│   │   └── feed.json                  # JSON feed of latest products
│   └── reports/
│       ├── accuracy_2026-02-12.json   # Daily accuracy report
│       ├── accuracy_weekly.json       # Weekly trend
│       └── field_coverage.json        # Per-field coverage stats
```

### Published JSON Schema (Full)

```jsonc
{
  "product_id": "mouse-razer-viper-v3-pro-wireless",
  "category": "mouse",
  "published_version": "1.2.0",
  "published_at": "2026-02-12T12:00:00Z",
  "field_rules_version": "1.0.0",
  "identity": {
    "brand": "Razer",
    "model": "Viper V3 Pro",
    "variant": "Wireless",
    "full_name": "Razer Viper V3 Pro Wireless",
    "slug": "razer-viper-v3-pro-wireless"
  },
  "specs": {
    // FLAT key-value for easy consumption
    "weight": 54,
    "length": 127.1,
    "width": 63.9,
    "height": 39.8,
    "sensor": "Focus Pro 26K V2",
    "dpi": 35000,
    "polling_rate": [8000, 4000, 2000, 1000, 500, 250, 125],
    "connection": "hybrid",
    "click_latency": 0.2,
    // ... all fields
  },
  "specs_with_metadata": {
    // Rich version with confidence and provenance
    "weight": {
      "value": 54,
      "unit": "g",
      "confidence": 0.98,
      "source": "razer.com",
      "source_tier": "tier1_manufacturer",
      "last_verified": "2026-02-12T10:30:00Z",

      // Minimal provenance pointers (full provenance lives in provenance.json)
      "source_id": "razer_com",
      "snippet_id": "snp_001",
      "snippet_hash": "sha256:…",
      "quote_span": [0, 27]
    }
    // ... all fields with metadata
  },
  "unknowns": {
    "encoder_brand": { "reason": "not_publicly_disclosed" },
    "shift_latency": { "reason": "not_found_after_search" }
  },
  "metrics": {
    "coverage": 0.831,
    "avg_confidence": 0.91,
    "sources_used": 5,
    "human_overrides": 3,
    "last_crawled": "2026-02-12T10:30:00Z"
  }
}
```

### Excel Output

```javascript
// Generate a comprehensive Excel workbook using ExcelJS
// Sheets:
//   1. "Products" — one row per product, one column per field
//   2. "Field Metadata" — field_key, display_name, type, unit, required_level
//   3. "Sources" — per-product list of sources used
//   4. "Unknowns" — all unk values with reason codes
//   5. "Changelog" — what changed since last publish
//   6. "Accuracy" — per-field accuracy metrics

// Conditional formatting:
//   - Confidence ≥ 0.85: green background
//   - Confidence 0.60–0.84: yellow background
//   - Confidence < 0.60: red background
//   - "unk" values: gray italic
//   - Overridden values: blue bold
```

### JSON-LD Output (Schema.org Product)

```jsonc
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Razer Viper V3 Pro Wireless",
  "brand": { "@type": "Brand", "name": "Razer" },
  "sku": "RZ01-04630100-R3A1",
  "gtin13": "8887910060025",
  "category": "Gaming Mouse",
  "description": "Lightweight wireless gaming mouse with Focus Pro 26K V2 sensor",
  "weight": { "@type": "QuantitativeValue", "value": 54, "unitCode": "GRM" },
  "additionalProperty": [
    { "@type": "PropertyValue", "name": "Sensor", "value": "Focus Pro 26K V2" },
    { "@type": "PropertyValue", "name": "Max DPI", "value": "35000" },
    { "@type": "PropertyValue", "name": "Polling Rate", "value": "8000 Hz" }
  ]
}
```

---


---

## DRIFT DETECTION & AUTO-REPUBLISH (ACCURACY OVER TIME)

Add a daily job that checks `page_content_hash` / `text_hash` for Tier 1+2 sources on recently published products.

- If hashes change, re-run extraction for the affected fields.
- If extracted values change (diff), queue the product for **review** before republishing.
- If evidence audit fails (snippet_hash mismatch), quarantine the product until a re-crawl rebuilds EvidencePack.

This prevents stale-but-wrong specs from silently living forever.

### Accuracy Monitoring System

```
MONITORING PIPELINE (runs daily/weekly):

1. GOLDEN-FILE BENCHMARK
   - Run field_rules validation against all golden files
   - Compare pipeline output vs ground truth
   - Compute per-field accuracy, precision, recall
   - Detect regressions (accuracy dropped since last run)

2. CONFIDENCE CALIBRATION
   - For products with human-verified values:
     - Compare confidence scores vs actual correctness
     - confidence=0.95 should be correct 95% of the time
     - Adjust scoring model if miscalibrated

3. SOURCE HEALTH CHECK
   - For each registered source:
     - Success rate over last 30 days
     - Average response time
     - Block rate (403s, CAPTCHAs)
     - Content freshness (are pages updated?)

4. FIELD COVERAGE TRENDS
   - For each field:
     - What % of products have this field filled?
     - Is coverage improving or declining?
     - Which fields are most commonly "unk"?

5. LLM PERFORMANCE TRACKING
   - Per model (Gemini Flash vs DeepSeek):
     - Extraction accuracy by field type
     - Parse failure rate
     - Average cost per product
     - Latency percentiles (p50, p95, p99)

6. ALERT GENERATION
   - Accuracy drops below 95% for any required field → ALERT
   - Source blocked for >24 hours → ALERT
   - LLM costs exceed daily budget → ALERT
   - Queue depth exceeds 50 (backlog) → ALERT
```

### Accuracy Report Schema

```jsonc
{
  "report_type": "accuracy",
  "category": "mouse",
  "generated_at": "2026-02-12T08:00:00Z",
  "period": "weekly",
  "summary": {
    "products_published": 87,
    "overall_accuracy": 0.947,
    "overall_coverage": 0.883,
    "human_override_rate": 0.06,
    "avg_review_time_seconds": 42,
    "total_llm_cost_usd": 7.83,
    "avg_cost_per_product": 0.09
  },
  "accuracy_by_group": {
    "identity": { "accuracy": 0.99, "trend": "stable" },
    "physical": { "accuracy": 0.97, "trend": "improving" },
    "sensor": { "accuracy": 0.95, "trend": "stable" },
    "switch": { "accuracy": 0.89, "trend": "improving" },
    "connectivity": { "accuracy": 0.97, "trend": "stable" },
    "performance": { "accuracy": 0.82, "trend": "declining" }
  },
  "regressions": [
    {
      "field": "click_latency",
      "previous_accuracy": 0.85,
      "current_accuracy": 0.78,
      "delta": -0.07,
      "likely_cause": "RTINGS changed measurement methodology",
      "suggested_action": "Update parse templates for new RTINGS format"
    }
  ],
  "top_failures": [
    { "field": "encoder_brand", "failure_rate": 0.78, "primary_reason": "not_publicly_disclosed" },
    { "field": "mcu_chip", "failure_rate": 0.65, "primary_reason": "not_publicly_disclosed" },
    { "field": "click_latency", "failure_rate": 0.22, "primary_reason": "source_dependent_review" }
  ]
}
```

### CLI Commands

```bash
# Publishing
node src/cli/spec.js publish --category mouse --product-id <id>
node src/cli/spec.js publish --category mouse --all-approved
node src/cli/spec.js publish --category mouse --format xlsx
node src/cli/spec.js publish --category mouse --format csv --output ./exports/

# Accuracy monitoring
node src/cli/spec.js accuracy-report --category mouse --period weekly
node src/cli/spec.js accuracy-benchmark --category mouse --golden-files
node src/cli/spec.js accuracy-trend --category mouse --field weight --period 90d

# Provenance
node src/cli/spec.js provenance --product-id <id> --field weight
node src/cli/spec.js provenance --product-id <id> --full
node src/cli/spec.js changelog --product-id <id>

# Source health
node src/cli/spec.js source-health --category mouse
node src/cli/spec.js source-health --source rtings_com --period 30d

# LLM metrics
node src/cli/spec.js llm-metrics --period week
node src/cli/spec.js llm-metrics --model gemini_flash --period month
```

---

## OPEN-SOURCE TOOLS & PLUGINS

### Required

| Tool | Purpose | Install |
|------|---------|---------|
| **ExcelJS** | Generate formatted Excel workbooks | `npm install exceljs` |
| **csv-stringify** | Generate CSV output | `npm install csv-stringify` |
| **better-sqlite3** | SQLite output + metrics storage | `npm install better-sqlite3` |
| **marked** | Markdown rendering for product pages | `npm install marked` |
| **handlebars** | Template engine for HTML comparison tables | `npm install handlebars` |
| **diff** | Compute diffs between published versions | `npm install diff` |
| **semver** | Version number management | `npm install semver` |
| **Chart.js** | Accuracy trend charts (for HTML reports) | `npm install chart.js` |
| **date-fns** | Date manipulation for reports | `npm install date-fns` |
| **Pino** | Structured logging | `npm install pino` |

### Recommended

| Tool | Purpose | Install |
|------|---------|---------|
| **@aws-sdk/client-s3** | S3 upload for cloud mirror | `npm install @aws-sdk/client-s3` |
| **archiver** | ZIP archives for bulk exports | `npm install archiver` |
| **json2csv** | Alternative CSV generator | `npm install json2csv` |
| **nodemailer** | Email alerts | `npm install nodemailer` |
| **@slack/webhook** | Slack alert integration | `npm install @slack/webhook` |

---

## ACCEPTANCE CRITERIA

1. ☐ Publishing merges ProductRecord + Overrides correctly
2. ☐ Final validation catches any fields that became invalid after override
3. ☐ JSON full output contains all fields with metadata
4. ☐ JSON compact output is flat key-value for easy consumption
5. ☐ Excel output has conditional formatting by confidence level
6. ☐ CSV output is importable into Google Sheets/Excel
7. ☐ SQLite output queryable with standard SQL
8. ☐ JSON-LD output validates against schema.org Product
9. ☐ Version history maintained (≥3 previous versions archived)
10. ☐ Accuracy benchmark runs against all golden files in <5 minutes
11. ☐ Accuracy report shows per-field, per-group, per-category metrics
12. ☐ Regression detection alerts when accuracy drops ≥5% on any field
13. ☐ Source health check identifies blocked or degraded sources
14. ☐ LLM cost tracking matches actual API billing within 10%
15. ☐ Provenance query traces any value back to URL + snippet + quote in <1 second
