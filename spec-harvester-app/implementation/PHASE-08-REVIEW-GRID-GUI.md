# PHASE 8 OF 10 — DATA REVIEW GRID GUI & HUMAN-IN-THE-LOOP OVERRIDES (EXCEL-FIRST)

**Version:** v2 (Excel-native grid)  
**Scope:** Localhost Review Workstation (NOT a dashboard)  
**Category baseline:** `mouse`  
**Excel source of truth:** `mouseData.xlsm` → `dataEntry` tab  
**Key range (universal contract):** `dataEntry!B9:B83` (75 keys)

---

## ROLE & CONTEXT

You are a senior frontend engineer building a **data-intensive, keyboard-driven review workstation**.  
Phases 1–7 built the automated pipeline from Field Rules → multi-round evidence extraction → ProductRecord output.  
Phase 8 builds the **Data Review Grid** that bridges 93% automated accuracy → **99%+ publishable accuracy** by enabling fast, evidence-backed human review **without re-crawling**.

This interface must let a reviewer complete a product in **30–60 seconds**.

**Dependencies**
- Phase 7: ProductRecord output (must include candidates + provenance)
- Phase 3: FieldRulesEngine (re-validate on every override)
- Phase 1: `field_rules.json` and `ui_field_catalog.json`
- Excel layout contract (this doc): `mouseData.xlsm` → `dataEntry` tab

---

## MISSION (NON-NEGOTIABLE)

Build a 24/7, evidence-first "Spec Factory" that can publish **15–20 products/day** with **~99% accuracy** by:

1) strict per-category field contracts,  
2) multi-round web + helper-source pipeline with per-field citations,  
3) helper artifacts for speed/consistency,  
4) **Data Review Grid** with overrides + suggestion feedback.

---

## THE CORE IDEA: THE UI IS A CLONE OF THE EXCEL ENTRY MATRIX

### Excel layout contract (MUST MATCH)

The Review Grid must mirror the Excel entry model exactly:

- **Each PRODUCT is a column** (Excel: `dataEntry` columns **C+**)
- **Each FIELD is a row** (Excel: `dataEntry` column **B**)
- **Brand/Model are pinned at the top of each product column header**
- The grid rows are shown in **the same order as Excel** (no re-sorting)

#### Mouse category: the authoritative field order

- **Brand:** `dataEntry!B3 = brand` (label in `A3 = Brand`)
- **Model:** `dataEntry!B4 = model`
- **Harvest keys (universal for this category):** `dataEntry!B9:B83`
  - These are the exact 75 keys the harvester must populate (because they are selected in Field Rules).
  - The UI must render these rows in this exact order.

> **Universal rule (for every category):** the Field Rules selection defines the Excel key range to review.  
> For mouse, that range is fixed to `dataEntry!B9:B83`.

---

## DELIVERABLES (PHASE 8)

### Deliverable 8A — Review Grid (Excel-order workstation)

A React (localhost) app that:
- Displays a dense matrix: **rows = keys**, **columns = products**
- **Column header** shows:
  - Brand (top line)
  - Model (second line)
  - Status pills (confidence/coverage/flags)
- **Row header** shows:
  - Group label (from Excel `dataEntry!A{row}`; blanks inherit previous)
  - Field label (from `ui_field_catalog.json`; fallback to the key)
- **Cell** displays the selected value (colored by confidence / conflict)
- **Cell dropdown** exposes **ALL candidates** (not only the selected one)
- **Cell expand** opens a mini-table:
  - candidate value, score, source, tier, evidence quote, clickable URL
  - highlighted snippet span (based on quote_span over snippet_text)
  - optional screenshot crop (if Phase 4 captured)

**Confidence coloring (default)**
- green: ≥ 0.85
- yellow: 0.60–0.84
- red: < 0.60 OR conflict flagged OR validation failed
- gray: missing/unknown/unfilled

**Navigation**
- keyboard-first (Tab/Shift+Tab through “needs review” cells)

---

### Deliverable 8B — Override System (non-destructive + audited)

A correction system that:
- Lets reviewer select a different candidate **without re-crawling**
- Allows manual entry **only with evidence** (URL + quote/snippet)
- Stores overrides separately from automated outputs (never overwrites pipeline output)
- Tracks who/when/why (audit trail)
- Re-runs FieldRulesEngine validation **on every override** and blocks invalid commits (unless explicitly “save as draft”)

---

### Deliverable 8C — Suggestion Feedback System (curated loop)

A feedback loop that writes “pending suggestions” for control-plane approval:

- new enum value → `_suggestions/new_enum_values.json`
- new component → `_suggestions/new_components.json`
- new alias mapping → `_suggestions/new_aliases.json`

Suggestions are **never auto-applied**. They are queued for admin review + golden test + merge.

---

### Deliverable 8D — Review Queue + Triage

A queue interface that:
- Lists products needing review (sorted by urgency / flags)
- Filters by: confidence threshold, flagged fields, category
- Bulk actions:
  - approve all greens (fast)
  - flag identity issues
- Tracks throughput:
  - products/hour
  - overrides/product
  - average review time

---

## EXCEL → UI MAPPING TABLE (MUST IMPLEMENT)

| Excel (mouseData.xlsm → dataEntry) | Meaning | UI representation |
|---|---|---|
| **Columns C+** | Each column is a product | Each grid column = one product |
| **Row 3** (`A3=Brand`, `B3=brand`) | Brand key (header) | Pinned in product column header (line 1) |
| **Row 4** (`B4=model`) | Model key (header) | Pinned in product column header (line 2) |
| **Column B** | Field keys | Grid rows (row order = Excel order) |
| **Rows 9–83** (`B9:B83`) | Keys the harvester must populate | These are the ONLY required review rows for mouse Phase 8 grid |
| **Column A** (row group labels) | Visual grouping | Group headers in row label lane; blank = inherit previous group |

---

## UI LAYOUT (EXCEL-LIKE)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Queue: 12   Filter: Needs Review Only   Category: mouse   [Approve Greens] [Save]   │
├───────────────┬─────────────────────┬─────────────────────┬─────────────────────┬──┤
│ FIELD (pinned)│  Product Column #1  │  Product Column #2  │  Product Column #3  │… │
│               │  Brand: Razer       │  Brand: Logitech    │  Brand: Zowie       │  │
│               │  Model: Viper V3 Pro│  Model: G Pro X S2  │  Model: EC2-CW      │  │
├───────────────┼─────────────────────┼─────────────────────┼─────────────────────┼──┤
│ SORT          │  2019-06-17  (🟩)   │  2023-09-12 (🟩)    │  unk (⬜)           │  │
│ release_date  │                     │                     │                     │  │
├───────────────┼─────────────────────┼─────────────────────┼─────────────────────┼──┤
│ SORT          │  false (🟨)          │  true (🟩)           │  false (🟩)         │  │
│ discontinued  │                     │                     │                     │  │
├───────────────┼─────────────────────┼─────────────────────┼─────────────────────┼──┤
│ general       │  white+black (🟩)    │  black (🟩)          │  black (🟩)         │  │
│ colors        │                     │                     │                     │  │
└───────────────┴─────────────────────┴─────────────────────┴─────────────────────┴──┘

Click a cell → Candidate Drawer (right) with candidates + evidence + select/override.
```

---

## DATA CONTRACTS (BACKEND API)

### 1) Layout API (Excel-order rows)

**GET** `/api/layout/:category`

Returns the canonical row list in Excel order (B9–B83 for mouse) plus labels and grouping.

```jsonc
{
  "category": "mouse",
  "excel": {
    "workbook": "mouseData.xlsm",
    "sheet": "dataEntry",
    "key_range": "B9:B83",
    "brand_key_cell": "B3",
    "model_key_cell": "B4"
  },
  "rows": [
    {
      "excel_row": 9,
      "group": "SORT",
      "key": "release_date",
      "label": "Release date",
      "field_rule": { "type": "date", "required": true, "units": null, "enum_name": null }
    }
  ]
}
```

> Implementation note: for mouse, group comes from `A{row}`, key from `B{row}`, label from `ui_field_catalog.json`.

---

### 2) Queue API (which products need review)

**GET** `/api/review/queue?category=mouse&status=needs_review`

```jsonc
[
  {
    "product_id": "mouse-razer-viper-v3-pro-wireless",
    "brand": "Razer",
    "model": "Viper V3 Pro",
    "coverage": 0.83,
    "confidence": 0.89,
    "flags": 8,
    "updated_at": "2026-02-12T11:05:00Z"
  }
]
```

---

### 3) Product API (selected + candidates)

**GET** `/api/products/:id`

Must include, for every key in the layout rows:
- selected value
- confidence/status
- candidates with provenance/evidence

```jsonc
{
  "product_id": "mouse-razer-viper-v3-pro-wireless",
  "identity": { "brand": "Razer", "model": "Viper V3 Pro" },
  "fields": {
    "release_date": {
      "selected": { "value": "2024-04-12", "confidence": 0.92, "status": "ok" },
      "candidates": [
        {
          "value": "2024-04-12",
          "score": 0.92,
          "source_id": "razer_com",
          "tier": 1,
          "evidence": {
            "url": "...",
            "retrieved_at": "...",
            "snippet_id": "snp_010",
            "snippet_hash": "sha256:...",
            "quote": "Released April 12, 2024",
            "quote_span": [0, 21],
            "snippet_text": "..."
          }
        }
      ]
    }
  }
}
```

> If snippet_text is not stored inline, the evidence object must include a stable pointer so the UI can fetch it (e.g. `snippet_path`).

---

### 4) Override API (write non-destructive override)

**POST** `/api/products/:id/override`

- validates against FieldRulesEngine
- writes `data/overrides/<product_id>.json`
- returns updated field state + validation result

---

### 5) Suggestions API (write to _suggestions)

**POST** `/api/suggestions`

Appends to category suggestion files under `helper_files/<category>/_suggestions/`.

---

### 6) WebSocket

`/ws/queue` pushes queue updates when new ProductRecords finish.

---

## KEYBOARD SHORTCUTS (WORKSTATION REQUIRED)

Navigation:
- ↑/↓: move row
- ←/→: move product column
- Tab / Shift+Tab: jump to next/previous “needs review” cell
- Ctrl+← / Ctrl+→: previous/next product in queue

Actions:
- Enter: approve current cell selection
- Space: open candidate drawer for current cell
- 1–9: select candidate by index
- M: manual value entry (requires evidence URL + quote)
- E: open evidence URL in browser

Bulk:
- Ctrl+A: approve all green cells (current product) in <1s
- Ctrl+S: save overrides (draft or final)
- Ctrl+P: publish (only if required rows valid + approved)
- Ctrl+F: flag for re-crawl
- Esc: cancel

---

## OVERRIDE STORAGE (AUDITABLE)

```jsonc
// data/overrides/<product_id>.json
{
  "product_id": "mouse-razer-viper-v3-pro-wireless",
  "review_status": "approved",
  "reviewed_by": "reviewer_1",
  "reviewed_at": "2026-02-12T11:05:00Z",
  "review_time_seconds": 45,
  "overrides": {
    "release_date": {
      "override_source": "candidate_selection",
      "candidate_index": 0,
      "original_value": "unk",
      "override_value": "2024-04-12",
      "override_reason": "Official launch date on manufacturer site",
      "override_provenance": {
        "url": "https://...",
        "source_id": "razer_com",
        "retrieved_at": "2026-02-12T10:31:02Z",
        "snippet_id": "snp_010",
        "snippet_hash": "sha256:...",
        "quote_span": [0, 21],
        "quote": "Released April 12, 2024"
      },
      "validated": true,
      "overridden_by": "reviewer_1",
      "overridden_at": "2026-02-12T11:00:00Z"
    }
  }
}
```

Manual entries MUST include evidence; create `manual_snp_*` ids so evidence audits remain strict.

---

## ACCEPTANCE CRITERIA (EXCEL-FIRST)

1. ☐ Grid row order matches `dataEntry!B9:B83` exactly (mouse)  
2. ☐ Product columns correspond to queue products (C+ behavior)  
3. ☐ Brand + Model are pinned at top of each product column header  
4. ☐ Row group labels mirror Excel column A behavior (blank inherits previous)  
5. ☐ Confidence coloring matches thresholds and conflict/validation status  
6. ☐ Clicking a cell shows ALL candidates (value, score, tier, source)  
7. ☐ Evidence URL opens; evidence panel highlights `quote_span` within `snippet_text`  
8. ☐ Overrides persist separately and never mutate raw pipeline output  
9. ☐ Overrides trigger FieldRulesEngine validation; invalid values are blocked (unless “draft”)  
10. ☐ Keyboard review: Tab through flagged, Enter approve, 1–9 candidate select  
11. ☐ Ctrl+A approves greens in <1s for a typical product  
12. ☐ Suggestion submission writes to `_suggestions/` with evidence  
13. ☐ Queue triage sorts by urgency and supports bulk actions  
14. ☐ WebSocket updates queue when new ProductRecords complete  
15. ☐ Responsive: usable at 1080p and 1440p; dense mode available  

---

## IMPLEMENTATION NOTES (UNIVERSALITY)

To make this universal across categories:
- Every category defines:
  - workbook name + sheet (usually `dataEntry`)
  - key range (like `B9:B83`)
  - identity header keys (brand/model row cells, or identity mapping)
- The compiler generates `excel_layout.json` during Phase 2 so UI never guesses.
- The Review Grid renders purely from:
  1) `/api/layout/:category` (row order + labels)
  2) `/api/review/queue`
  3) `/api/products/:id` (selected + candidates + evidence)

No hardcoded mouse-only row lists in the frontend.

