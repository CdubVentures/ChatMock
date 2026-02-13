# PHASE 6 OF 10 — IDENTITY GATE & PRODUCT DISAMBIGUATION SYSTEM

## ROLE & CONTEXT

You are a senior data-quality engineer specializing in entity resolution. Phases 1–5 built everything from field rules through extraction. This phase builds the **Identity Gate** — the system that ensures you are collecting specs for the CORRECT product and not a similar variant, predecessor, or entirely different product.

This is the single biggest source of silent data corruption in spec aggregation. "Razer Viper V3 Pro" vs "Razer Viper V3 HyperSpeed" vs "Razer Viper V3 Pro SE" — these are DIFFERENT products with different specs. If the Identity Gate fails, you get a record that looks correct but has specs from the wrong product. At 99% accuracy targets, this must be near-zero.

**Dependencies:** Phase 4 (crawling, EvidencePack) + Phase 5 (extraction) must be complete.

---

## MISSION (NON-NEGOTIABLE)

Build a 24/7, evidence-first "Spec Factory" that can publish 15–20 products per day with ~99% accuracy on expected fields by: (1) strict per-category field contracts, (2) multi-round web + helper-source pipeline with per-field citations, (3) helper artifacts for speed/consistency, (4) Data Review Grid with overrides.

---

## WHAT THIS PHASE DELIVERS

### Deliverable 6A: Identity Anchor System

A canonical identity representation per product:
- **Brand + Model + Variant** as the three-part identity key
- Anchor tokens derived from official naming
- SKU/MPN/GTIN/UPC as hard identifiers when available
- Alias registry for common naming variations

### Deliverable 6B: Page-Level Identity Verification

Before extracting ANY specs from a page, verify:
- Does this page describe the target product?
- Is this the right variant (not a different color/edition)?
- Is this a comparison page? If so, which data is for which product?
- Is this a product FAMILY page (showing multiple variants)?

### Deliverable 6C: Multi-Source Identity Reconciliation

After crawling multiple sources, verify:
- Do all sources refer to the same product?
- Are there conflicting identity signals across sources?
- Should any source be excluded due to identity mismatch?

### Deliverable 6D: Disambiguation Decision Engine

When identity is ambiguous:
- Use DeepSeek Reasoning to analyze naming patterns
- Apply edit-distance thresholds
- Check component DB for discriminating specs
- Route to human review when confidence < threshold

---

## DETAILED ARCHITECTURE

### Identity Anchor Schema

```jsonc
{
  "product_id": "mouse-razer-viper-v3-pro-wireless",
  "identity": {
    "brand": "Razer",
    "model": "Viper V3 Pro",
    "variant": "Wireless",
    "base_model": "Viper V3 Pro",

    // Hard identifiers (any match = confirmed identity)
    "hard_ids": {
      "sku": "RZ01-04630100-R3A1",
      "mpn": "RZ01-04630100",
      "gtin": "8887910060025",
      "upc": null,
      "asin": "B0D5CDZBJB"
    },

    // Anchor tokens (for fuzzy matching against page text)
    "anchor_tokens": {
      "required": ["razer", "viper", "v3", "pro"],      // ALL must be present
      "discriminating": ["wireless", "54g", "paw3950"],  // At least 1 should appear
      "negative": ["hyperspeed", "mini", "ultimate", "se", "v2"]  // NONE should appear (would indicate wrong product)
    },

    // Known aliases for this product
    "aliases": [
      "Razer Viper V3 Pro",
      "Viper V3 Pro Wireless",
      "RZ01-04630100",
      "razer viper v3pro"
    ],

    // Products commonly confused with this one
    "confusion_set": [
      {
        "product_id": "mouse-razer-viper-v3-hyperspeed",
        "discriminators": ["HyperSpeed has 58g weight", "HyperSpeed uses PAW3395 sensor"],
        "key_differences": {
          "weight": { "this": 54, "other": 58 },
          "sensor": { "this": "Focus Pro 26K V2", "other": "PAW3395" }
        }
      },
      {
        "product_id": "mouse-razer-viper-v2-pro",
        "discriminators": ["V2 Pro is predecessor", "V2 Pro uses Focus Pro 30K sensor"],
        "key_differences": {
          "sensor": { "this": "Focus Pro 26K V2", "other": "Focus Pro 30K" },
          "weight": { "this": 54, "other": 58 }
        }
      }
    ]
  }
}
```

### Page-Level Identity Verification

```
VERIFICATION PIPELINE (runs for EVERY crawled page):

Step 0: STRUCTURED PRODUCT SIGNALS (highest precision)
  - Extract JSON-LD Product nodes + meta tags (og:title, sku, gtin, mpn)
  - If ANY structured hard ID matches target → CONFIRMED (confidence 1.0)
  - If a structured hard ID is present but DOESN'T match target → REJECTED (wrong product)
  - If structured signals are missing → continue

Step 1: HARD ID CHECK (visible text)
  - Search main content + spec tables for SKU, MPN, GTIN, UPC, ASIN
  - Ignore nav/header/footer to avoid false positives (cross-sells often contain other SKUs)
  - If ANY hard ID matches → CONFIRMED (confidence 1.0)
  - If hard ID found but DOESN'T match → REJECTED (wrong product)

Step 2: ANCHOR TOKEN CHECK
  - Check required tokens: ALL must appear in page title/heading/URL
  - Check negative tokens: NONE should appear in page title/heading
  - If all required present and no negatives → LIKELY (confidence 0.85)
  - If any required missing → SUSPECT (confidence 0.50)
  - If any negative present → LIKELY WRONG (confidence 0.20)

Step 3: URL PATTERN CHECK
  - Compare URL slug against expected patterns from source registry
  - URL contains brand + model in slug → +0.10 confidence
  - URL matches template exactly → +0.15 confidence

Step 4: PAGE STRUCTURE CHECK
  - Is this a single-product page or multi-product comparison?
  - If comparison → segment the page and extract ONLY sections about target product
  - If product family page → identify correct variant section
  - If search results page → REJECT (need to navigate to product page)

Step 5: LLM CONFIRMATION (if confidence < 0.85)
  - Send page title + first 500 chars to Gemini Flash
  - Ask: "Is this page about {brand} {model} {variant}? Yes/No/Partial"
  - If Partial → ask which sections contain target product data

Step 6: RECORD IDENTITY SNAPSHOT (auditability)
  - Store page identity signals in EvidencePack.sources[source_id].identity:
      { confidence, matched_hard_ids[], matched_required_tokens[], matched_negative_tokens[], decision, reason_codes[] }

DECISION:
  confidence ≥ 0.85 → PROCEED with extraction
  confidence 0.60–0.84 → PROCEED with WARNING (flag for review)
  confidence 0.40–0.59 → EXTRACT BUT QUARANTINE (don't auto-accept)
  confidence < 0.40 → SKIP (don't extract from this page)
```

### Multi-Source Identity Reconciliation

```javascript
class IdentityReconciler {
  reconcile(evidencePack, pageIdentities) {
    // After all pages are crawled and identity-verified:
    
    const confirmed = [];
    const warnings = [];
    const rejected = [];
    
    for (const [sourceKey, identity] of Object.entries(pageIdentities)) {
      if (identity.confidence >= 0.85) {
        confirmed.push({ source: sourceKey, ...identity });
      } else if (identity.confidence >= 0.60) {
        warnings.push({ source: sourceKey, ...identity });
      } else {
        rejected.push({ source: sourceKey, ...identity });
      }
    }
    
    // Cross-source consistency check
    if (confirmed.length >= 2) {
      // Check that confirmed sources agree on key identity fields
      const brands = [...new Set(confirmed.map(c => c.brand))];
      const models = [...new Set(confirmed.map(c => c.model))];
      
      if (brands.length > 1 || models.length > 1) {
        // CRITICAL: Sources disagree on identity → halt and flag
        return {
          status: 'IDENTITY_CONFLICT',
          message: `Sources disagree: ${brands.join(' vs ')} / ${models.join(' vs ')}`,
          needs_review: true,
          confirmed, warnings, rejected
        };
      }
    }
    
    if (confirmed.length === 0 && warnings.length > 0) {
      return {
        status: 'LOW_CONFIDENCE',
        message: 'No high-confidence identity matches',
        needs_review: true,
        confirmed, warnings, rejected
      };
    }
    
    if (confirmed.length === 0 && warnings.length === 0) {
      return {
        status: 'IDENTITY_FAILED',
        message: 'Could not confirm product identity from any source',
        needs_review: true,
        confirmed, warnings, rejected
      };
    }
    
    return {
      status: 'CONFIRMED',
      message: `Identity confirmed by ${confirmed.length} source(s)`,
      needs_review: false,
      confirmed, warnings, rejected
    };
  }
}
```


---

## IDENTITY REPORT ARTIFACT (ACCURACY INSURANCE)

Write a per-run artifact so you can answer: *“Why did we accept this page as the right product?”*

**File:** `data/runs/<run_id>/identity_report.json`

```jsonc
{
  "product_id": "mouse-razer-viper-v3-pro-wireless",
  "run_id": "run_20260212_001",
  "pages": [
    {
      "source_id": "razer_com",
      "url": "https://www.razer.com/gaming-mice/razer-viper-v3-pro/specifications",
      "decision": "CONFIRMED",
      "confidence": 1.0,
      "matched_hard_ids": { "mpn": "RZ01-04630100" },
      "matched_required_tokens": ["razer","viper","v3","pro"],
      "matched_negative_tokens": [],
      "reason_codes": ["hard_id_match"]
    }
  ],
  "status": "CONFIRMED",
  "needs_review": false
}
```

This report is also what the Review Grid shows when a product is flagged for identity issues.

### Disambiguation with DeepSeek

```javascript
// When identity is ambiguous, use DeepSeek reasoning
const DISAMBIGUATION_PROMPT = `You are a product identification expert. I need to determine if a web page is about a specific product.

TARGET PRODUCT:
  Brand: {brand}
  Model: {model}
  Variant: {variant}
  Known SKU: {sku}
  Key distinguishing specs: {discriminators}

CONFUSION PRODUCTS (similar but different):
{confusionSet}

PAGE CONTENT (first 2000 chars):
{pageText}

QUESTIONS:
1. Is this page about the target product specifically?
2. Could it be about one of the confusion products instead?
3. What specific evidence confirms or denies the identity?
4. If this is a comparison page, which sections are about the target?

Respond with structured JSON.`;
```

---

## OPEN-SOURCE TOOLS & PLUGINS

| Tool | Purpose | Install |
|------|---------|---------|
| **Fuse.js** | Fuzzy matching for product names | `npm install fuse.js` |
| **string-similarity** | Dice coefficient for name matching | `npm install string-similarity` |
| **natural** | NLP toolkit (tokenization, edit distance) | `npm install natural` |
| **fastest-levenshtein** | Fast edit distance computation | `npm install fastest-levenshtein` |

---

## ACCEPTANCE CRITERIA

1. ☐ Identity anchor generated for all 50 golden-file products
2. ☐ Confusion sets defined for at least 10 commonly-confused product pairs
3. ☐ Page-level verification correctly identifies right product pages (≥95% accuracy)
4. ☐ Page-level verification correctly rejects wrong product pages (≥98% rejection rate)
5. ☐ Comparison pages correctly segmented (product A vs product B data separated)
6. ☐ Hard ID match (SKU/ASIN) overrides fuzzy matching
7. ☐ Negative anchor tokens correctly reject similar-but-wrong products
8. ☐ Multi-source reconciliation detects identity conflicts
9. ☐ DeepSeek disambiguation resolves ≥80% of ambiguous cases without human input
10. ☐ Identity verification adds <5 seconds per page to pipeline
11. ☐ Identity failures produce clear reason codes for human review
12. ☐ System works across ALL categories (monitor, keyboard, GPU, CPU) — not mouse-specific logic
