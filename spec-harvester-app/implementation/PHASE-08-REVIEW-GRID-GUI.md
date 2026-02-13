# PHASE 8 OF 10 — DATA REVIEW GRID GUI & HUMAN-IN-THE-LOOP OVERRIDES

## ROLE & CONTEXT

You are a senior frontend engineer building data-intensive review interfaces. Phases 1–7 built the entire automated pipeline from field rules through production orchestration. This phase builds the **Data Review Grid** — the human interface that bridges the gap between 93% automated accuracy and 99%+ published accuracy.

This is NOT a dashboard for pretty charts. It is a **high-speed data review workstation** designed for a human reviewer to inspect, approve, override, and correct spec data at 30–60 seconds per product. The reviewer sees ALL candidate values from ALL sources, the confidence scores, the evidence citations, and can make corrections without re-crawling.

**Dependencies:** Phase 7 (ProductRecord output) must be complete. Phase 3 (FieldRulesEngine) and Phase 1 (field_rules, ui_field_catalog.json) are also used.

---

## MISSION (NON-NEGOTIABLE)

Build a 24/7, evidence-first "Spec Factory" that can publish 15–20 products per day with ~99% accuracy on expected fields by: (1) strict per-category field contracts, (2) multi-round web + helper-source pipeline with per-field citations, (3) helper artifacts for speed/consistency, (4) Data Review Grid with overrides and suggestion feedback.

---

## WHAT THIS PHASE DELIVERS

### Deliverable 8A: Review Grid — The Main Interface

A React-based web application (localhost) that:
- Displays a product's complete field data in a dense, scannable grid
- Groups fields by category (identity, physical, sensor, switch, connectivity, etc.)
- Color-codes by confidence (green=high, yellow=medium, red=low/conflict)
- Shows ALL candidates per field (not just the selected one)
- Links every value to its source evidence (clickable URL + **highlighted snippet span**)
- (Optional) Shows the per-snippet screenshot crop captured in Phase 4 for pixel-perfect review
- Supports keyboard-driven review (Tab/Enter to approve, arrow keys to navigate)

### Deliverable 8B: Override System

A non-destructive correction system that:
- Allows reviewer to select a different candidate (from the list) without re-crawling
- Allows reviewer to type a manual value with evidence URL
- Stores overrides separately from automated data (never overwrites raw pipeline output)
- Tracks who overrode what and when (audit trail)
- Re-runs validation through FieldRulesEngine on every override

### Deliverable 8C: Suggestion Feedback System

A curated feedback loop that:
- When reviewer approves a NEW enum value → adds to `_suggestions/new_enum_values.json`
- When reviewer approves a NEW component → adds to `_suggestions/new_components.json`
- When reviewer corrects an alias → adds to `_suggestions/new_aliases.json`
- Suggestions are NOT auto-applied to field rules — they queue for control plane approval
- Approval workflow: suggestion → review → test against golden files → merge into _source/

### Deliverable 8D: Review Queue Management

A triage interface that:
- Shows all products needing review (sorted by urgency)
- Filters by: confidence threshold, specific fields flagged, category
- Bulk actions (approve all high-confidence products, flag all identity issues)
- Tracks reviewer productivity (products/hour, overrides/product)

---

## DETAILED ARCHITECTURE

### Tech Stack

```
Frontend:
  React 18 + TypeScript
  Tailwind CSS (utility-first styling)
  TanStack Table v8 (virtualized data grid — handles 154+ fields)
  React Query (data fetching + cache)
  React Hot Keys (keyboard shortcuts)
  Zustand (lightweight state management)
  
Backend (local API server):
  Express.js or Fastify
  Serves ProductRecord data
  Handles override writes
  Handles suggestion submissions
  WebSocket for real-time queue updates

Data Storage:
  File-based (JSON): ProductRecords, overrides, suggestions
  SQLite (optional): review history, metrics, audit log
```

### Review Grid Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ ◄ Prev  │  Razer Viper V3 Pro — Wireless  │  Next ►  │ Queue: 12  │
│          │  Confidence: 89% │ Coverage: 83% │ Flags: 8 │            │
├──────────┴───────────────────┴───────────────┴──────────┴───────────┤
│                                                                      │
│  ┌── IDENTITY ─────────────────────────────────────────────────────┐ │
│  │ Brand      │ Razer          │ ✓ 0.99 │ razer.com         │ [✓] │ │
│  │ Model      │ Viper V3 Pro   │ ✓ 0.99 │ razer.com         │ [✓] │ │
│  │ Variant    │ Wireless       │ ✓ 0.95 │ razer.com         │ [✓] │ │
│  │ SKU        │ RZ01-04630100  │ ✓ 0.99 │ razer.com         │ [✓] │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌── PHYSICAL ─────────────────────────────────────────────────────┐ │
│  │ Weight     │ 54 g           │ ✓ 0.98 │ razer.com ×3      │ [✓] │ │
│  │ Length     │ 127.1 mm       │ ✓ 0.95 │ razer.com         │ [✓] │ │
│  │ Width      │ 63.9 mm        │ ✓ 0.95 │ razer.com         │ [✓] │ │
│  │ Height     │ 39.8 mm        │ ✓ 0.95 │ razer.com         │ [✓] │ │
│  │ Coating    │ matte          │ ○ 0.75 │ rtings.com        │ [?] │ │ ← yellow (medium)
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌── SENSOR ───────────────────────────────────────────────────────┐ │
│  │ Sensor     │ Focus Pro 26K  │ ✓ 0.92 │ razer.com         │ [✓] │ │
│  │ Max DPI    │ 35000          │ ✓ 0.95 │ razer.com         │ [✓] │ │
│  │ Max IPS    │ 750            │ ○ 0.80 │ razer.com         │ [?] │ │
│  │ Latency    │ 0.2 ms         │ ⚠ 0.50 │ rtings vs tpu     │ [!] │ │ ← red (conflict)
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ══════════════════════════════════════════════════════════════════   │
│                                                                      │
│  CANDIDATE DETAIL (selected: Sensor Latency)                         │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Candidate 1: 0.2 ms  │ RTINGS      │ Tier 2 │ Score: 0.85     │ │
│  │   Quote: "Click Latency: 0.2 ms"                                │ │
│  │   URL: https://rtings.com/mouse/reviews/razer/viper-v3-pro      │ │
│  │                                                                  │ │
│  │ Candidate 2: 0.3 ms  │ TechPowerUp │ Tier 2 │ Score: 0.82     │ │
│  │   Quote: "Average click latency measured at 0.3ms"              │ │
│  │   URL: https://techpowerup.com/review/razer-viper-v3-pro        │ │
│  │                                                                  │ │
│  │ [Select Candidate 1] [Select Candidate 2] [Enter Manual Value]  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌── ACTIONS ──────────────────────────────────────────────────────┐ │
│  │ [Approve All High-Confidence] [Flag for Re-crawl] [Publish]     │ │
│  │ [Skip Product] [Mark as Discontinued]                           │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Keyboard Shortcuts

```
Navigation:
  ↑/↓         Move between fields
  Tab         Next field needing review
  Shift+Tab   Previous field needing review
  PageUp/Down Scroll by group
  Ctrl+←/→    Previous/Next product
  
Actions:
  Enter       Approve selected field value
  Space       Toggle candidate selection panel
  1–9         Select candidate by number
  M           Enter manual value mode
  E           Open evidence URL in browser
  
Bulk:
  Ctrl+A      Approve all green (high-confidence) fields
  Ctrl+P      Publish product (all fields approved)
  Ctrl+S      Save overrides without publishing
  Ctrl+F      Flag product for re-crawl
  Escape      Cancel current action
```

### Override Storage

```jsonc
// data/overrides/<product_id>.json
{
  "product_id": "mouse-razer-viper-v3-pro-wireless",
  "overrides": {
    "click_latency": {
      "original_value": 0.2,
      "original_confidence": 0.50,
      "override_value": 0.2,
      "override_reason": "Selected RTINGS value — more recent test methodology",
      "override_source": "candidate_selection",
      "candidate_index": 0,

      // Critical: store provenance so Phase 9 can publish without losing auditability
      "override_provenance": {
        "url": "https://www.rtings.com/mouse/reviews/razer/viper-v3-pro",
        "source_id": "rtings_com",
        "retrieved_at": "2026-02-12T10:31:02Z",
        "snippet_id": "snp_010",
        "snippet_hash": "sha256:…",
        "quote_span": [0, 20],
        "quote": "Click Latency: 0.2 ms"
      },

      "overridden_by": "reviewer_1",
      "overridden_at": "2026-02-12T11:00:00Z",
      "validated": true
    },
    "coating": {
      "original_value": "matte",
      "original_confidence": 0.75,
      "override_value": "matte with textured sides",
      "override_reason": "More accurate description from RTINGS detail",
      "override_source": "manual_entry",

      // Manual entries MUST still be evidence-backed.
      // The Review Grid should create a synthetic snippet_id (manual_snp_*) so Phase 3 evidence audit still applies.
      "manual_evidence": {
        "url": "https://www.rtings.com/mouse/reviews/razer/viper-v3-pro",
        "manual_snippet_id": "manual_snp_001",
        "snippet_hash": "sha256:…",
        "quote_span": [123, 167],
        "quote": "The body has a matte finish with textured rubber sides"
      },
      "overridden_by": "reviewer_1",
      "overridden_at": "2026-02-12T11:01:00Z",
      "validated": true,
      "suggestion_submitted": {
        "type": "new_enum_value",
        "enum_name": "coating",
        "value": "matte with textured sides",
        "status": "pending_approval"
      }
    }
  },
  "review_status": "approved",
  "reviewed_by": "reviewer_1",
  "reviewed_at": "2026-02-12T11:05:00Z",
  "review_time_seconds": 45
}
```

### Suggestion Feedback Schema

```jsonc
// helper_files/<category>/_suggestions/new_enum_values.json
{
  "suggestions": [
    {
      "suggestion_id": "sug_001",
      "type": "new_enum_value",
      "field_key": "coating",
      "enum_name": "coating",
      "proposed_value": "matte with textured sides",
      "proposed_aliases": ["matte textured", "textured matte"],
      "evidence": {
        "product_id": "mouse-razer-viper-v3-pro-wireless",
        "url": "https://www.rtings.com/mouse/reviews/razer/viper-v3-pro",
        "snippet_id": "snp_0xx",
        "snippet_hash": "sha256:…",
        "quote_span": [123, 167],
        "quote": "The body has a matte finish with textured rubber sides"
      },
      "submitted_by": "reviewer_1",
      "submitted_at": "2026-02-12T11:01:00Z",
      "status": "pending",
      "approved_by": null,
      "approved_at": null,
      "merged_in_version": null
    }
  ]
}
```

### Suggestion Approval Workflow

```
1. REVIEWER finds new enum value during review → submits suggestion
2. Suggestion written to _suggestions/*.json
3. ADMIN runs: node src/cli/spec.js suggestions list --category mouse
4. ADMIN reviews suggestion:
   a. Checks evidence quality
   b. Checks if alias should map to existing canonical value
   c. Checks impact (how many products affected)
5. ADMIN approves: node src/cli/spec.js suggestions approve --id sug_001
6. System:
   a. Adds to _source/field_catalog.xlsx enum sheet
   b. Triggers recompilation (Phase 2)
   c. Re-validates affected products against updated rules
   d. Marks suggestion as merged
```

### Backend API (Express/Fastify)

```
GET  /api/review/queue                    → List products needing review
GET  /api/review/queue/stats              → Queue statistics
GET  /api/products/:id                    → Full ProductRecord
GET  /api/products/:id/candidates/:field  → All candidates for a field
POST /api/products/:id/override           → Submit override for a field
POST /api/products/:id/approve            → Approve product for publishing
POST /api/products/:id/flag               → Flag for re-crawl
POST /api/suggestions                     → Submit new suggestion
GET  /api/suggestions                     → List pending suggestions
POST /api/suggestions/:id/approve         → Approve suggestion
GET  /api/metrics/review                  → Reviewer productivity metrics

WebSocket /ws/queue                       → Real-time queue updates
```

---

## OPEN-SOURCE TOOLS & PLUGINS

### Frontend

| Tool | Purpose | Install |
|------|---------|---------|
| **React 18** | UI framework | `npx create-vite@latest review-grid -- --template react-ts` |
| **TanStack Table v8** | Virtualized data grid for 154+ fields | `npm install @tanstack/react-table` |
| **TanStack Virtual** | Virtual scrolling for large datasets | `npm install @tanstack/react-virtual` |
| **Tailwind CSS** | Utility-first styling | `npm install tailwindcss @tailwindcss/forms` |
| **Zustand** | Lightweight state management | `npm install zustand` |
| **React Query** | Server state + caching | `npm install @tanstack/react-query` |
| **react-hotkeys-hook** | Keyboard shortcut handling | `npm install react-hotkeys-hook` |
| **react-tooltip** | Tooltip for evidence previews | `npm install react-tooltip` |
| **Lucide React** | Icon set | `npm install lucide-react` |
| **Sonner** | Toast notifications | `npm install sonner` |

### Backend

| Tool | Purpose | Install |
|------|---------|---------|
| **Fastify** | Fast API server | `npm install fastify @fastify/cors @fastify/websocket` |
| **better-sqlite3** | Local audit log and metrics | `npm install better-sqlite3` |

---

## ACCEPTANCE CRITERIA

1. ☐ Review Grid displays a complete ProductRecord with all 154 fields grouped correctly
2. ☐ Color-coding reflects confidence: green ≥0.85, yellow 0.60–0.84, red <0.60
3. ☐ Clicking a field shows ALL candidates with source, tier, score, and quote
4. ☐ Evidence URL is clickable and opens in browser
4b. ☐ Evidence panel highlights the exact `quote_span` inside the snippet text (and shows screenshot crop if available)
5. ☐ Override system saves selections without modifying original pipeline data
6. ☐ Manual value entry runs through FieldRulesEngine validation before saving
7. ☐ Keyboard navigation works: Tab through flagged fields, Enter to approve, 1–9 for candidate selection
8. ☐ Ctrl+A approves all high-confidence fields in <1 second
9. ☐ Suggestion submission creates entry in _suggestions/ with evidence
10. ☐ Review queue shows products sorted by urgency (most flags first)
11. ☐ Bulk approve works for products with zero flags
12. ☐ Average review time per product is ≤60 seconds for products with <5 flags
13. ☐ Override audit trail tracks who, when, what, and why
14. ☐ Real-time WebSocket updates when new products complete pipeline
15. ☐ Responsive design works on 1080p and 1440p monitors
