# PHASE 3 OF 10 — FIELD RULES RUNTIME ENGINE (NO BYPASS)

## ROLE & CONTEXT

You are a senior runtime-systems engineer. Phases 1–2 built the authoring and compilation toolchain. This phase builds the **canonical runtime engine** — the single module that every part of the system uses to normalize, validate, and enforce field rules. This is the immune system of the Spec Factory. If a value cannot pass through this engine with valid evidence, it MUST become `unk`. There are no exceptions, no bypass paths, no "just this once."

**Dependencies:** Phase 1 (schemas, compiler) and Phase 2 (loader, golden files, Zod types) must be complete.

---

## MISSION (NON-NEGOTIABLE)

Build a 24/7, evidence-first "Spec Factory" that can publish 15–20 products per day with ~99% accuracy on expected fields by: (1) strict per-category field contracts, (2) multi-round evidence pipeline, (3) helper artifacts for speed/consistency, (4) Data Review Grid with overrides.

---

## WHAT THIS PHASE DELIVERS

### The Single Canonical Module: `src/engine/fieldRulesEngine.js`

This module is used by CLI, daemon, GUI, orchestrator, extractor, validator, and publisher. It is the **only** path through which field values enter the system.

### Core API Surface

```javascript
class FieldRulesEngine {
  constructor(category) // loads all artifacts via loader.js

  // ─── CANDIDATE PROCESSING ───
  normalizeCandidate(fieldKey, rawCandidate, context)
    → { ok: true, normalized, applied_rules[] }
    | { ok: false, reason_code, raw_input, attempted_normalizations[] }

  validateShapeAndUnits(fieldKey, normalized)
    → { ok: true }
    | { ok: false, reason_code, expected_shape, actual_shape }

  enforceEnumPolicy(fieldKey, normalized)
    → { ok: true, canonical_value, was_aliased: boolean }
    | { ok: false, reason_code, closest_match?, needs_curation: boolean }

  crossValidate(fieldKey, value, allFields)
    → { ok: true, checks_passed[] }
    | { ok: false, violations[], severity }

  validateRange(fieldKey, numericValue)
    → { ok: true }
    | { ok: false, reason_code, range_min, range_max, actual }

  // ─── EVIDENCE AUDIT ───
  auditEvidence(fieldKey, value, provenance)
    → { ok: true }
    | { ok: false, reason_code, missing[] }

  // ─── UNKNOWN BUILDER ───
  buildUnknown(fieldKey, unknown_reason, attempt_trace?)
    → { value: "unk", unknown_reason, attempt_trace?, field_metadata }

  // ─── RECORD-LEVEL ───
  applyKeyMigrations(record) → canonical record
  validateFullRecord(record) → { valid: boolean, errors[], warnings[] }
  normalizeFullRecord(rawRecord) → { normalized, failures[], unknowns[] }

  // ─── COMPONENT LOOKUP ───
  lookupComponent(dbName, query) → ComponentEntry | null
  fuzzyMatchComponent(dbName, query, threshold?) → { match, score, alternatives[] }

  // ─── PARSE SUPPORT ───
  getParseTemplate(fieldKey) → ParseTemplate | null
  applyParseTemplate(fieldKey, text) → { matched: boolean, value?, pattern_used? }

  // ─── METADATA QUERIES ───
  getFieldsByGroup(group) → FieldRule[]
  getFieldsByRequiredLevel(level) → FieldRule[]
  getFieldsByAvailability(availability) → FieldRule[]
  getFieldsForRound(roundNumber) → { targetFields[], maxEffort }
  getRequiredFields() → FieldRule[]
  getCriticalFields() → FieldRule[]
  getAllFieldKeys() → string[]
}
```

---

## DETAILED IMPLEMENTATION

### 1. normalizeCandidate()

This is the most complex function. It runs a pipeline of normalizers in order:

```
NORMALIZATION PIPELINE (per field):

Step 1: TYPE COERCION
  - string → number (if data_type=number/integer)
  - string → boolean (if data_type=boolean)
  - string → date (if data_type=date)
  - Strip whitespace, normalize unicode
  - Handle "N/A", "n/a", "none", "-", "—", "" → null

Step 2: UNIT NORMALIZATION
  - If unit is defined, extract numeric value + unit from string
  - Convert unit_aliases to canonical unit (oz→g, lbs→g, inches→mm)
  - Apply conversion functions from normalization_functions.js
  - Example: "3.5 oz" → 99.2g (if unit=g)

Step 3: SHAPE ENFORCEMENT
  - If output_shape=scalar and value is array → take first / reject (field-specific; default=reject)
  - If output_shape=list:
      - Canonical normalized type is an Array (never a flattened string in runtime records)
      - If value is scalar → wrap in array
      - If value is string → split by list_separator and/or template separators
      - Coerce each element to the field's data_type (e.g., number list)
      - Sort list values if specified
      - Deduplicate list values (after normalization)

  NOTE: Flattening list values to strings is ONLY allowed at publish/export time (Phase 9), never inside the engine.

Step 4: ROUNDING
  - Apply rounding rule (integer, 1dp, 2dp, 3dp)
  - Example: 54.3g with rounding=integer → 54

Step 5: ENUM RESOLUTION
  - If enum_policy=closed or open:
    - Try exact match against known_values
    - Try case-insensitive match
    - Try alias match (alias_map + known_values aliases)
    - If Fuse.js available, try fuzzy match with threshold
    - Return canonical value or fail

Step 6: COMPONENT RESOLUTION
  - If component_db_ref is set:
    - Look up in component database
    - Try exact match, then alias match, then fuzzy
    - If matched, attach component metadata for cross-validation

Step 7: RANGE CHECK
  - If range_min/range_max defined, verify value is within bounds
  - Tolerance: allow 5% overshoot with warning (configurable)

Step 8: CUSTOM NORMALIZATION
  - If normalization_fn defined, run named function
  - Named functions in normalization_functions.js:
    strip_unit_suffix, parse_date_excel, parse_polling_list,
    parse_dimension_list, normalize_color_list, parse_latency_list,
    normalize_boolean_string, parse_price_range, etc.

RESULT:
  - If ALL steps pass: { ok: true, normalized: <value>, applied_rules: [...] }
  - If ANY step fails: { ok: false, reason_code: <code>, raw_input, attempted: [...] }
```

### 2. Evidence Audit (HARD INVARIANT)

To improve accuracy and auditability, **all accepted values must be traceable to an exact character span in a stored snippet** (not a paraphrase). This lets the engine verify evidence deterministically and lets the Review Grid highlight the exact text that justified a value.

```
EVIDENCE INVARIANT — NO EXCEPTIONS:

For EVERY field where value ≠ "unk":
  ✓ provenance.url MUST be a valid URL string
  ✓ provenance.source_id MUST exist in EvidencePack.sources
  ✓ provenance.snippet_id MUST be a non-empty string
  ✓ provenance.snippet_hash MUST match EvidencePack.snippets[snippet_id].snippet_hash
  ✓ EvidencePack.snippets[snippet_id] MUST exist and include snippet.normalized_text
  ✓ Evidence must be VERIFIABLE, not paraphrased:
      - If provenance.quote_span is present:
          ✓ quote_span = [start, end] offsets into snippet.normalized_text
          ✓ snippet.normalized_text.slice(start, end) MUST equal provenance.quote (after whitespace canonicalization)
      - Else (no quote_span):
          ✓ provenance.quote MUST be an exact substring of snippet.normalized_text
  ✓ provenance.retrieved_at MUST be present (ISO-8601 timestamp)
  ✓ provenance.extraction_method MUST be one of:
      spec_table_match | parse_template | json_ld | llm_extract | api_fetch | component_db_inference

If ANY check fails:
  → field becomes "unk" with unknown_reason="evidence_missing"
  → If snippet_hash mismatch (evidence drift) use unknown_reason="evidence_stale" and flag product for re-crawl

EVIDENCE PROVENANCE SCHEMA:
{
  "url": "https://...",
  "source_id": "razer_com",
  "source_host": "razer.com",
  "tier": "tier1_manufacturer",
  "retrieved_at": "2026-02-12T10:30:00Z",

  "snippet_id": "snp_abc123",
  "snippet_hash": "sha256:…",
  "quote_span": [18, 32],
  "quote": "Weight: 54 g",

  "extraction_method": "spec_table_match|parse_template|json_ld|llm_extract|api_fetch",
  "confidence": 0.95,
  "notes": null
}
```

### 3. Enum Policy Enforcement

```
CLOSED ENUM:
  1. Try exact canonical match
  2. Try case-insensitive canonical match
  3. Try alias match (exact, then case-insensitive)
  4. If no match → { ok: false, reason: "enum_value_not_allowed" }
  5. NEVER accept unknown values for closed enums

OPEN ENUM:
  1. Try exact canonical match
  2. Try case-insensitive canonical match
  3. Try alias match
  4. If no match:
     a. Check if value passes basic token rules (no special chars, reasonable length)
     b. Check if value has evidence (URL + snippet)
     c. If both pass → { ok: true, canonical: raw_value, needs_curation: true }
     d. Mark in suggestions queue for human review
  5. New tokens auto-added to _suggestions/new_enum_values.json

TOKEN RULES FOR OPEN ENUMS:
  - Length: 1–100 characters
  - No HTML tags
  - No URLs (those go in evidence, not values)
  - No numeric-only (except for component model numbers)
  - Must be present in source evidence text
```

### 4. Cross-Validation Engine

```javascript
// Cross-validation runs AFTER individual field normalization
// It checks inter-field consistency

class CrossValidator {
  validate(fields, rules, componentDBs) {
    const results = [];
    for (const rule of rules) {
      // Check if trigger field exists and has a value
      if (!fields[rule.trigger_field] || fields[rule.trigger_field] === 'unk') continue;

      switch (rule.check.type) {
        case 'component_db_lookup':
          // e.g., "dpi must not exceed sensor's max_dpi"
          const component = componentDBs[rule.check.db].entries[fields[rule.check.lookup_field]];
          if (component) {
            const limit = component.properties[rule.check.compare_field];
            if (fields[rule.trigger_field] > limit * (1 + rule.check.tolerance_percent/100)) {
              results.push({ rule: rule.rule_id, severity: 'error', message: `...` });
            }
          }
          break;

        case 'conditional_require':
          // e.g., "if connection=wireless, battery_hours must exist"
          if (evalCondition(rule.condition, fields)) {
            if (!fields[rule.requires_field] || fields[rule.requires_field] === 'unk') {
              results.push({ rule: rule.rule_id, severity: 'warning', message: `...` });
            }
          }
          break;

        case 'range':
          // e.g., "weight must be 30-200g"
          if (fields[rule.trigger_field] < rule.check.min || fields[rule.trigger_field] > rule.check.max) {
            results.push({ rule: rule.rule_id, severity: 'error', message: `...` });
          }
          break;

        case 'group_completeness':
          // e.g., "if length exists, width and height should too"
          const present = rule.related_fields.filter(f => fields[f] && fields[f] !== 'unk').length;
          if (present < rule.check.minimum_present) {
            results.push({ rule: rule.rule_id, severity: 'warning', message: `...` });
          }
          break;

        case 'mutual_exclusion':
          // e.g., "cannot have both wireless_only and cable_type"
          break;
      }
    }
    return results;
  }
}
```

### 5. Unknown Builder

Every `unk` value must be standardized:

```jsonc
{
  "value": "unk",
  "unknown_reason": "not_found_after_search",    // from enum
  "field_key": "encoder_brand",
  "required_level": "expected",
  "difficulty": "hard",
  "attempt_trace": {
    "rounds_attempted": 3,
    "sources_checked": ["razer.com", "rtings.com", "techpowerup.com"],
    "parse_attempts": 2,
    "llm_attempts": 1,
    "closest_candidate": null,
    "rejection_reason": null
  }
}
```


---

## CONFIDENCE SEMANTICS & CALIBRATION (ACCURACY LEVER)

Confidence must be treated as a **calibrated probability of correctness**, not just a heuristic score.

Add the following runtime rules:

1. **Calibration source of truth**
   - Use golden-file benchmarks and human overrides as labels.
   - Track calibration by field group and extraction method (parse_template vs llm_extract).

2. **Calibration metrics**
   - Compute Brier score + reliability curves per bucket (0.5–0.6, 0.6–0.7, …).
   - A confidence of 0.90 should be correct ~90% of the time in golden fixtures.

3. **Action thresholds**
   - confidence ≥ 0.85: auto-approve eligible (unless identity_confidence low)
   - 0.60–0.84: review recommended
   - < 0.60: review required / quarantined

4. **Hard downgrades (accuracy protection)**
   - If evidence audit required an auto-repair (quote mismatch correction), cap confidence at 0.75.
   - If source tier is below the field’s `evidence_tier_preference[0]`, cap confidence at 0.80.
   - If the Identity Gate classified the page as WARNING, cap confidence at 0.70.

These calibration rules make confidence actionable and prevent “high-confidence wrong” fields from slipping through.

---

## NORMALIZATION FUNCTIONS LIBRARY

### File: `src/engine/normalization-functions.js`

```javascript
// These are reusable across ALL categories

const NORMALIZATION_FUNCTIONS = {
  // ─── NUMERIC ───
  strip_unit_suffix: (val) => parseFloat(String(val).replace(/[a-zA-Z%°]+$/, '').trim()),
  strip_commas: (val) => String(val).replace(/,/g, ''),
  oz_to_g: (val) => Math.round(parseFloat(val) * 28.3495),
  lbs_to_g: (val) => Math.round(parseFloat(val) * 453.592),
  inches_to_mm: (val) => +(parseFloat(val) * 25.4).toFixed(1),
  cm_to_mm: (val) => +(parseFloat(val) * 10).toFixed(1),

  // ─── LISTS ───
  parse_polling_list: (val) => {
    // "8000, 4000, 2000, 1000, 500, 250, 125" → sorted desc array
    return String(val).split(/[,/]/).map(s => parseInt(s.trim())).filter(n => !isNaN(n)).sort((a,b) => b-a);
  },
  parse_dimension_list: (val) => {
    // "133.3 x 77.5 x 49mm" → { length: 133.3, width: 77.5, height: 49 }
    const nums = String(val).match(/[\d.]+/g);
    if (nums && nums.length >= 3) {
      return { length: +nums[0], width: +nums[1], height: +nums[2] };
    }
    return null;
  },
  normalize_color_list: (val) => {
    // "white+black, gray+black" → ["white+black", "gray+black"]
    return String(val).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  },
  parse_latency_list: (val) => {
    // "14 wireless, 16 wired" → [{ mode: "wireless", value: 14 }, { mode: "wired", value: 16 }]
    const parts = String(val).split(',').map(s => s.trim());
    return parts.map(p => {
      const match = p.match(/([\d.]+)\s*(wireless|wired|bluetooth|usb|2\.4g)/i);
      if (match) return { value: parseFloat(match[1]), mode: match[2].toLowerCase() };
      const numOnly = p.match(/([\d.]+)/);
      if (numOnly) return { value: parseFloat(numOnly[1]), mode: 'default' };
      return null;
    }).filter(Boolean);
  },

  // ─── DATES ───
  parse_date_excel: (val) => {
    // Excel serial date → ISO date string
    if (typeof val === 'number') {
      const date = new Date((val - 25569) * 86400 * 1000);
      return date.toISOString().split('T')[0];
    }
    return String(val);
  },

  // ─── BOOLEANS ───
  normalize_boolean: (val) => {
    const s = String(val).toLowerCase().trim();
    if (['yes','true','1','y'].includes(s)) return true;
    if (['no','false','0','n'].includes(s)) return false;
    return null;
  },

  // ─── STRINGS ───
  normalize_brand: (val) => {
    // Capitalize first letter of each word, handle special cases
    const special = { 'logitech g': 'Logitech G', 'hyperx': 'HyperX', 'msi': 'MSI' };
    const lower = String(val).toLowerCase().trim();
    return special[lower] || String(val).trim().replace(/\b\w/g, c => c.toUpperCase());
  }
};
```

---

## OPEN-SOURCE TOOLS & PLUGINS

| Tool | Purpose | Install |
|------|---------|---------|
| **Zod** | Runtime schema validation for all values | `npm install zod` |
| **Fuse.js** | Fuzzy matching for alias/component resolution | `npm install fuse.js` |
| **string-similarity** | Dice coefficient for fuzzy string matching | `npm install string-similarity` |
| **validator** | String validation (URLs, emails, etc.) | `npm install validator` |
| **convert-units** | Unit conversion library | `npm install convert-units` |
| **date-fns** | Date parsing and formatting | `npm install date-fns` |
| **lodash** | Utility functions (deep merge, clone, get) | `npm install lodash` |
| **fast-deep-equal** | Fast deep equality checks | `npm install fast-deep-equal` |

---

## TESTING REQUIREMENTS

### Unit Tests (src/engine/__tests__/)

```
fieldRulesEngine.test.js:
  - normalizeCandidate: 50+ test cases per data type
  - validateShapeAndUnits: scalar, list, structured for each
  - enforceEnumPolicy: closed accept, closed reject, open accept, open curation
  - crossValidate: all rule types
  - buildUnknown: all reason codes
  - Full record normalization: 10 complete product records

evidence-auditor.test.js:
  - Valid evidence passes
  - Missing URL fails
  - Missing snippet_id fails
  - Missing quote fails
  - snippet_id not in EvidencePack fails
  - Quote not matching snippet text fails

normalization-functions.test.js:
  - Every normalization function with 10+ test cases
  - Edge cases: null, undefined, empty string, NaN
  - Unit conversions: known exact values
```

### Integration Tests

```
golden-file-integration.test.js:
  - Load each golden file
  - Run normalizeFullRecord against field_rules
  - Compare output to expected.json
  - Report per-field accuracy
  - Fail if accuracy drops below baseline
```

---

## ACCEPTANCE CRITERIA

1. ☐ `FieldRulesEngine` class fully implemented with all methods above
2. ☐ normalizeCandidate handles all data_types (string, number, integer, boolean, date, url, enum, component_ref)
3. ☐ Enum policy correctly enforces closed (reject) and open (curation queue) behavior
4. ☐ Cross-validation catches: sensor DPI overflow, wireless→battery requirement, weight range, dimension group
5. ☐ Evidence auditor rejects values missing url, snippet_id, or quote
6. ☐ Unknown builder produces standardized output with all reason codes
7. ☐ All 50 golden files pass through normalizeFullRecord without crashes
8. ☐ Golden-file accuracy report shows >95% on required/critical fields
9. ☐ Unit conversion works for: oz→g, lbs→g, inches→mm, cm→mm
10. ☐ Fuzzy matching resolves at least 90% of alias variations in golden files
11. ☐ 200+ unit tests passing
12. ☐ Engine loads in <100ms for any category
13. ☐ No value can be accepted without passing through this engine (enforced by architecture)
14. ☐ `npm test` passes all existing + new tests
