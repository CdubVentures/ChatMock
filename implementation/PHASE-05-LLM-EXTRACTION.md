# PHASE 5 OF 10 — LLM-POWERED FIELD EXTRACTION & DETERMINISTIC PARSING

## ROLE & CONTEXT

You are a senior ML-pipeline engineer specializing in structured information extraction. Phases 1–4 built the field rules, compilation, runtime engine, and crawling pipeline. This phase builds the **extraction layer** — the system that takes raw evidence (EvidencePack from Phase 4) and produces typed, validated candidate field values with provenance.

This phase is where accuracy is won or lost. The philosophy: **deterministic first, LLM second**. Parse templates handle easy fields in microseconds at 100% accuracy. LLMs handle ambiguous, multi-source, natural-language fields where patterns fail. Both paths produce identical output: a typed candidate with evidence citation.

**Dependencies:** Phase 3 (FieldRulesEngine) + Phase 4 (EvidencePack with snippets) must be complete.

---

## MISSION (NON-NEGOTIABLE)

Build a 24/7, evidence-first "Spec Factory" that can publish 15–20 products per day with ~99% accuracy on expected fields by: (1) strict per-category field contracts, (2) multi-round web + helper-source pipeline with per-field citations, (3) helper artifacts for speed/consistency, (4) Data Review Grid with overrides.

---

## WHAT THIS PHASE DELIVERS

### Deliverable 5A: Deterministic Parse Engine

A pattern-matching extraction system that:
- Uses parse_templates.json (from Phase 1) to extract values via regex
- Handles spec tables, key-value pairs, and structured HTML
- Produces candidates with exact snippet_id citations
- Runs in <50ms per field — no LLM cost
- Handles 40–60% of all fields deterministically

### Deliverable 5B: LLM Extraction Pipeline

A structured extraction system that:
- Uses **Gemini 2.0 Flash** for simple extraction tasks (identity, physical specs, yes/no fields)
- Uses **DeepSeek Reasoning (R1/V3)** for complex reasoning tasks (conflict resolution, disambiguating variants, interpreting lab data)
- Uses **Instructor-JS** with Zod schemas to guarantee structured output
- Batches fields intelligently (by group, by evidence source)
- Caches LLM responses (content-addressed) to avoid re-extraction
- Produces candidates with snippet_id citations

### Deliverable 5C: Candidate Merger & Confidence Scoring

A system that:
- Merges candidates from deterministic + LLM extraction
- Scores each candidate by evidence quality + source tier + extraction method
- Handles multi-source conflicts with configurable resolution rules
- Produces a ranked list of candidates per field
- Selects the best candidate or flags for human review

---

## DETAILED ARCHITECTURE

### Extraction Pipeline Flow

```
EvidencePack (from Phase 4)
     │
     ▼
┌─────────────────────────────────────────────────┐
│          STAGE 1: DETERMINISTIC PARSING          │
│                                                   │
│  For each field in field_rules:                   │
│    1. Check if parse_template exists              │
│    2. Run regex against ALL snippets              │
│    3. Match spec table rows by key similarity     │
│    4. Extract JSON-LD values by schema mapping    │
│    5. Produce candidates with snippet_id refs     │
│                                                   │
│  Expected yield: 40–60% of fields                 │
│  Cost: $0.00                                      │
│  Time: <2 seconds total                           │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│     STAGE 2: COMPONENT DB CROSS-REFERENCE        │
│                                                   │
│  For fields with component_db_ref:                │
│    1. If sensor name extracted → lookup in DB     │
│    2. Auto-fill related fields from DB entry      │
│    3. Cross-validate extracted vs DB values        │
│                                                   │
│  Expected yield: 5–10% additional fields          │
│  Cost: $0.00                                      │
│  Time: <500ms                                     │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│     STAGE 3: LLM EXTRACTION (remaining fields)   │
│                                                   │
│  Batch unfilled fields by evidence source:        │
│    Batch A: Manufacturer page fields              │
│    Batch B: Lab review fields                     │
│    Batch C: Retailer page fields                  │
│                                                   │
│  For each batch:                                  │
│    1. Build context window from relevant snippets │
│    2. Include field definitions + expected shapes  │
│    3. Call LLM with structured output schema      │
│    4. Parse response via Instructor-JS/Zod        │
│    5. Attach snippet_id citations                 │
│                                                   │
│  Expected yield: 20–40% additional fields         │
│  Cost: $0.02–$0.15 per product                    │
│  Time: 5–30 seconds                               │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│     STAGE 4: CANDIDATE MERGER & SCORING          │
│                                                   │
│  For each field with 1+ candidates:               │
│    1. Score by: source_tier × extraction_method    │
│    2. Check agreement across candidates            │
│    3. Apply field-specific preference rules        │
│    4. Select winner or flag for review             │
│    5. Run through FieldRulesEngine                 │
│                                                   │
│  For fields with 0 candidates:                    │
│    → buildUnknown() with appropriate reason code  │
└─────────────────────────────────────────────────┘
```

---

### Stage 1: Deterministic Parse Engine

#### File: `src/extract/deterministicParser.js`

```javascript
class DeterministicParser {
  constructor(fieldRulesEngine) {
    this.engine = fieldRulesEngine;
    this.parseTemplates = fieldRulesEngine.getAllParseTemplates();
  }

  extractFromEvidencePack(evidencePack) {
    const candidates = {};  // fieldKey → Candidate[]

    for (const [fieldKey, template] of Object.entries(this.parseTemplates)) {
      candidates[fieldKey] = [];

      // Strategy 1: Regex patterns against all snippets
      for (const [snippetId, snippet] of Object.entries(evidencePack.snippets)) {
        for (const pattern of template.patterns) {
          const regex = new RegExp(pattern.regex, 'gi');
          const match = regex.exec(snippet.text);
          if (match && match[pattern.group]) {
            // Check context: is this snippet about the RIGHT field?
            if (this.contextMatch(snippet.text, template)) {
              candidates[fieldKey].push({
                value: match[pattern.group],
                raw_match: match[0],
                extraction_method: 'parse_template',
                pattern_used: pattern.regex,

                // Provenance (MUST pass Phase 3 evidence audit)
                source_id: snippet.source,
                snippet_id: snippetId,
                snippet_hash: snippet.snippet_hash,
                quote: match[0],                         // exact regex match (verbatim)
                quote_span: snippet.normalized_text
                  ? [regex.lastIndex - match[0].length, regex.lastIndex]  // example span calc
                  : null,

                source: evidencePack.sources[snippet.source],
                confidence: 0.95  // High confidence for regex match
              });
            }
          }
        }
      }

      // Strategy 2: Spec table key matching
      for (const [snippetId, snippet] of Object.entries(evidencePack.snippets)) {
        if (snippet.type === 'spec_table_row') {
          const similarity = this.keyMatch(snippet.key, fieldKey, template);
          if (similarity > 0.8) {
            candidates[fieldKey].push({
              value: snippet.value,
              extraction_method: 'spec_table_match',
              key_matched: snippet.key,
              similarity_score: similarity,

              // Provenance
              source_id: snippet.source,
              snippet_id: snippetId,
              snippet_hash: snippet.snippet_hash,
              quote: snippet.text,          // table row is the exact evidence
              quote_span: snippet.normalized_text ? [0, snippet.normalized_text.length] : null,

              source: evidencePack.sources[snippet.source],
              confidence: similarity * 0.95
            });
          }
        }
      }

      // Strategy 3: JSON-LD mapping (JSON-LD is stored as first-class snippets in the EvidencePack)
      for (const [snippetId, snippet] of Object.entries(evidencePack.snippets)) {
        if (snippet.type !== 'json_ld_product') continue;

        let product = null;
        try { product = JSON.parse(snippet.text); } catch { continue; }

        const mapping = this.getJsonLdMapping(fieldKey);
        if (mapping && product && product[mapping.path] != null) {
          candidates[fieldKey].push({
            value: product[mapping.path],
            extraction_method: 'json_ld',
            json_path: mapping.path,

            // Provenance
            source_id: snippet.source,
            snippet_id: snippetId,
            snippet_hash: snippet.snippet_hash,
            quote: snippet.text,
            quote_span: snippet.normalized_text ? [0, snippet.normalized_text.length] : null,

            source: evidencePack.sources[snippet.source],
            confidence: 0.90
          });
        }
      }
    }

    return candidates;
  }

  contextMatch(text, template) {
    // Positive: at least one context keyword present
    const hasPositive = template.context_keywords?.some(
      kw => text.toLowerCase().includes(kw.toLowerCase())
    );
    // Negative: none of the negative keywords present
    const hasNegative = template.negative_keywords?.some(
      kw => text.toLowerCase().includes(kw.toLowerCase())
    );
    return hasPositive && !hasNegative;
  }

  keyMatch(tableKey, fieldKey, template) {
    // Multi-strategy key matching for spec table rows
    const normalizedKey = tableKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedField = fieldKey.replace(/_/g, '');

    // Exact match after normalization
    if (normalizedKey === normalizedField) return 1.0;

    // Keyword match
    const keywords = template.context_keywords || [fieldKey.replace(/_/g, ' ')];
    for (const kw of keywords) {
      if (normalizedKey.includes(kw.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        return 0.9;
      }
    }

    // Fuzzy match via string-similarity
    const similarity = stringSimilarity.compareTwoStrings(normalizedKey, normalizedField);
    return similarity;
  }
}
```

---

### Stage 2: Component DB Cross-Reference

```javascript
class ComponentResolver {
  constructor(fieldRulesEngine) {
    this.engine = fieldRulesEngine;
  }

  resolveComponents(candidates, evidencePack) {
    const enriched = { ...candidates };

    // Example: if sensor field has a candidate, look up in sensors DB
    for (const [fieldKey, rule] of Object.entries(this.engine.getAllRules())) {
      if (!rule.component_db_ref) continue;

      const sensorCandidates = candidates[fieldKey];
      if (!sensorCandidates?.length) continue;

      const bestCandidate = sensorCandidates[0];
      const component = this.engine.fuzzyMatchComponent(
        rule.component_db_ref,
        bestCandidate.value,
        0.7  // threshold
      );

      if (component?.match) {
        // Auto-fill related fields from component DB
        bestCandidate.component_match = component.match;
        bestCandidate.component_score = component.score;

        // For each property in the component entry, check if that field needs filling
        for (const [propKey, propValue] of Object.entries(component.match.properties)) {
          const mappedField = this.getComponentFieldMapping(fieldKey, propKey);
          if (mappedField && (!enriched[mappedField] || enriched[mappedField].length === 0)) {
            enriched[mappedField] = enriched[mappedField] || [];
            enriched[mappedField].push({
              value: propValue,
              extraction_method: 'component_db_inference',
              inferred_from: { field: fieldKey, value: bestCandidate.value },
              snippet_id: bestCandidate.snippet_id,  // cite same evidence
              source: bestCandidate.source,
              confidence: 0.85,  // Slightly lower — inferred, not directly extracted
              needs_verification: true
            });
          }
        }
      }
    }

    return enriched;
  }
}
```

---

### Stage 3: LLM Extraction Pipeline

#### LLM Strategy: TWO MODELS, DISTINCT ROLES

```
┌─────────────────────────────────────────────────────────────┐
│                    LLM MODEL ASSIGNMENT                      │
│                                                               │
│  GEMINI 2.0 FLASH — Fast Extractor ($0.10/1M input tokens)  │
│  ═══════════════════════════════════════════════════════════  │
│  Use for:                                                     │
│    • Identity confirmation (is this the right product?)       │
│    • Simple spec extraction from clear text                   │
│    • Boolean fields (yes/no/present/absent)                   │
│    • Enum classification (form_factor, connection_type)       │
│    • List extraction (color options, included accessories)    │
│    • Price extraction                                         │
│  Why: Fast (0.5–1s), cheap, good at following instructions    │
│  Context: Up to 1M tokens — can handle entire pages           │
│  Output: Structured JSON via Instructor-JS                    │
│                                                               │
│  DEEPSEEK REASONING (R1/V3) — Deep Analyzer ($0.55/1M in)   │
│  ═══════════════════════════════════════════════════════════  │
│  Use for:                                                     │
│    • Multi-source conflict resolution                         │
│    • Variant disambiguation (V3 Pro vs V3 Pro SE)             │
│    • Interpreting lab measurement data                         │
│    • Inferring unstated specs from context                     │
│    • Complex cross-validation reasoning                       │
│    • Understanding marketing language vs actual specs          │
│    • Determining if a value is for THIS product or a           │
│      compared product in a review                             │
│  Why: Strong reasoning, chain-of-thought, good at nuance     │
│  Context: 64K–128K tokens                                     │
│  Output: Structured JSON with reasoning trace                 │
│                                                               │
│  ROUTING LOGIC:                                               │
│    if field.difficulty in ['easy','medium'] → Gemini Flash    │
│    if field.difficulty in ['hard','instrumented'] → DeepSeek  │
│    if conflict_resolution_needed → DeepSeek                   │
│    if identity_ambiguous → DeepSeek                           │
│    if source_dependent field → DeepSeek                       │
│    else → Gemini Flash (default)                              │
└─────────────────────────────────────────────────────────────┘
```

#### Instructor-JS Integration (CRITICAL)

```javascript
// Instructor-JS forces LLM output into validated Zod schemas
// This eliminates ~80% of parse failures from raw LLM output

import Instructor from '@instructor-ai/instructor';
import { z } from 'zod';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';  // DeepSeek uses OpenAI-compatible API

// Initialize Gemini client
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });

// Initialize DeepSeek client (OpenAI-compatible)
const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY
});

// Wrap with Instructor for structured output
const deepseekInstructor = Instructor({
  client: deepseek,
  mode: 'JSON'  // Force JSON output mode
});
```

#### Field Batching Strategy

```
BATCHING RULES — DO NOT send 154 fields in one LLM call:

Batch 1: IDENTITY (4–6 fields)
  Fields: brand, model, variant, base_model, sku, mpn
  Evidence: manufacturer page title + spec table header
  Model: Gemini Flash
  Max tokens: ~2000

Batch 2: PHYSICAL (6–10 fields)
  Fields: weight, length, width, height, material, color, coating, cable_length
  Evidence: manufacturer spec table
  Model: Gemini Flash
  Max tokens: ~3000

Batch 3: SENSOR + PERFORMANCE (8–12 fields)
  Fields: sensor, dpi, max_ips, max_acceleration, polling_rate, tracking_speed, lod
  Evidence: manufacturer spec table + lab review data
  Model: Gemini Flash (simple) / DeepSeek (if conflict)
  Max tokens: ~4000

Batch 4: SWITCH + BUTTONS (6–10 fields)
  Fields: switch, switch_rated_clicks, click_force, main_buttons, side_buttons, dpi_button
  Evidence: manufacturer spec table + teardown data
  Model: Gemini Flash
  Max tokens: ~3000

Batch 5: CONNECTIVITY (6–8 fields)
  Fields: connection, wireless_tech, usb_receiver, bluetooth_version, cable_type, cable_connector
  Evidence: manufacturer spec table
  Model: Gemini Flash
  Max tokens: ~3000

Batch 6: LAB-MEASURED (4–8 fields)
  Fields: click_latency, motion_latency, sensor_latency, lift_off_distance
  Evidence: RTINGS/TechPowerUp lab data
  Model: DeepSeek (source-dependent, needs reasoning)
  Max tokens: ~5000

Batch 7: FEATURES + ERGONOMICS (10–15 fields)
  Fields: rgb, software, onboard_memory, feet_type, grip_width, hump_position
  Evidence: mixed sources
  Model: Gemini Flash
  Max tokens: ~4000

Each batch gets its OWN LLM call with:
  - Only the relevant evidence snippets (filtered by field_hints)
  - Only the relevant field definitions (from field_rules)
  - A Zod schema for the expected output shape
  - Explicit instruction to output "unk" with reason if not found
```

#### LLM Prompt Template (Gemini Flash — Simple Extraction)

```javascript
const EXTRACTION_PROMPT = `You are a precision spec extractor. Extract product specifications from the evidence provided.

PRODUCT: {brand} {model} {variant}
CATEGORY: {category}

FIELDS TO EXTRACT:
{fieldDefinitions}

EVIDENCE:
{snippetsText}

RULES:
1. Extract ONLY from the evidence text above — never infer or guess
2. For each field, choose ONE best `snippet_id` that contains the value
3. Copy an exact, verbatim `quote` from that snippet (no paraphrasing)
4. Provide `quote_span` = [start, end] offsets into the snippet's `normalized_text`
5. If a field cannot be found in the evidence, set value to "unk" and provide `unknown_reason`
6. Normalize values to the specified units (e.g., convert oz to grams)
7. For enum fields, use ONLY the canonical values listed
8. For list fields, output a JSON array (not a comma-separated string)
9. DO NOT extract specs for comparison products mentioned in reviews — only the target product

OUTPUT FORMAT: JSON matching the schema provided.`;

// Zod schema for extraction output (auto-generated from field_rules)
const ExtractionBatchSchema = z.object({
  product_confirmed: z.boolean(),
  fields: z.record(z.string(), z.object({
    // NOTE: list/structured fields MUST stay structured (arrays/objects), not flattened strings.
    value: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
      z.record(z.any())
    ]),

    // Evidence (must pass Phase 3 audit)
    snippet_id: z.string().nullable(),
    snippet_hash: z.string().nullable(),
    quote: z.string().nullable(),
    quote_span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),

    confidence: z.number().min(0).max(1),
    notes: z.string().optional(),
    unknown_reason: z.string().optional()
  }))
});
```

#### LLM Prompt Template (DeepSeek — Complex Reasoning)

```javascript
const REASONING_PROMPT = `You are an expert product analyst. You need to resolve complex extraction challenges for product specifications.

PRODUCT: {brand} {model} {variant}

CHALLENGE: {challengeType}
// e.g., "Multiple sources disagree on the weight of this product"
// e.g., "Determine if this is the Viper V3 Pro or V3 Pro SE"
// e.g., "Extract click latency — RTINGS measures differently than manufacturer"

SOURCE A ({sourceTierA}): {evidenceA}
SOURCE B ({sourceTierB}): {evidenceB}
{... additional sources}

FIELD RULES:
{relevantFieldRules}

Think through this step by step:
1. What does each source claim?
2. Which source is more authoritative for this specific field?
3. Are the values within acceptable tolerance (±{tolerancePercent}%)?
4. What is the most likely correct value?
5. Should this be flagged for human review?

OUTPUT: JSON matching the schema provided.`;
```

#### LLM Response Caching

```javascript
// Content-addressed cache: hash(prompt + evidence) → response
// Saves 30–40% of LLM costs on re-runs

import objectHash from 'object-hash';

class LLMCache {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;  // local file cache
  }

  getCacheKey(prompt, evidence, model) {
    return objectHash({ prompt, evidence, model }, { algorithm: 'sha256' });
  }

  async get(key) {
    const path = `${this.cacheDir}/${key}.json`;
    try {
      const data = await fs.readFile(path, 'utf8');
      const cached = JSON.parse(data);
      // Check TTL (default: 7 days for spec data)
      if (Date.now() - cached.timestamp < cached.ttl) {
        return cached.response;
      }
    } catch { return null; }
    return null;
  }

  async set(key, response, ttlMs = 7 * 24 * 60 * 60 * 1000) {
    const path = `${this.cacheDir}/${key}.json`;
    await fs.writeFile(path, JSON.stringify({
      response,
      timestamp: Date.now(),
      ttl: ttlMs
    }));
  }
}
```

---


---

## EVIDENCE VERIFIER (ACCURACY FIREWALL)

Before any LLM candidate is allowed to compete in scoring, run a deterministic **Evidence Verifier**:

- Confirm `snippet_id` exists
- Confirm `snippet_hash` matches the current snippet
- Confirm `quote_span` slices the snippet and equals `quote`
- Confirm the extracted `value` text appears inside the cited snippet (or table cell) for non-numeric fields

If verification fails, **drop the candidate** (or convert to `unk` with `unknown_reason="evidence_missing"`). This single step prevents the most common high-confidence failure mode: *LLM paraphrasing that cannot be audited later*.

Optional auto-repair (safe): if `value` is numeric and `quote` is missing, attempt to locate the number string inside the snippet and rebuild `quote_span`.

### Stage 4: Candidate Merger & Confidence Scoring

```javascript
class CandidateMerger {
  constructor(fieldRulesEngine) {
    this.engine = fieldRulesEngine;
  }

  mergeCandidates(deterministicCandidates, llmCandidates, componentCandidates) {
    const allCandidates = {};

    // Combine all candidate sources
    for (const source of [deterministicCandidates, llmCandidates, componentCandidates]) {
      for (const [fieldKey, candidates] of Object.entries(source)) {
        allCandidates[fieldKey] = (allCandidates[fieldKey] || []).concat(candidates);
      }
    }

    const results = {};

    for (const [fieldKey, candidates] of Object.entries(allCandidates)) {
      if (candidates.length === 0) {
        results[fieldKey] = this.engine.buildUnknown(fieldKey, 'not_found_after_search');
        continue;
      }

      // Score each candidate
      const scored = candidates.map(c => ({
        ...c,
        composite_score: this.computeScore(fieldKey, c)
      })).sort((a, b) => b.composite_score - a.composite_score);

      // Check for conflicts
      const uniqueValues = [...new Set(scored.map(c => String(c.value)))];

      if (uniqueValues.length === 1) {
        // All sources agree — high confidence
        results[fieldKey] = {
          value: scored[0].value,
          confidence: Math.min(1.0, scored[0].composite_score + 0.1),
          candidates: scored,
          agreement: 'unanimous',
          selected_reason: 'all_sources_agree'
        };
      } else {
        // Conflict — resolve
        results[fieldKey] = this.resolveConflict(fieldKey, scored);
      }
    }

    return results;
  }

  computeScore(fieldKey, candidate) {
    const rule = this.engine.getFieldRule(fieldKey);
    let score = 0;

    // Source tier weight (0.1 – 0.3)
    const tierWeights = {
      tier1_manufacturer: 0.30,
      tier2_lab: 0.28,
      tier3_retailer: 0.20,
      tier4_community: 0.12,
      tier5_aggregator: 0.10
    };
    score += tierWeights[candidate.source?.tier] || 0.10;

    // Extraction method weight (0.1 – 0.3)
    const methodWeights = {
      spec_table_match: 0.30,
      parse_template: 0.28,
      json_ld: 0.25,
      llm_extract: 0.20,
      component_db_inference: 0.15
    };
    score += methodWeights[candidate.extraction_method] || 0.15;

    // Field-specific source preference bonus
    if (rule.preferred_source_hosts?.some(h => candidate.source?.url?.includes(h))) {
      score += 0.15;
    }

    // Evidence quality (verifiable > paraphrased)
    if (candidate.snippet_id && (candidate.quote_span || candidate.quote)) score += 0.15;
    if (candidate.snippet_hash) score += 0.05;
    if (candidate.confidence) score += candidate.confidence * 0.10;

    return Math.min(1.0, score);
  }

  resolveConflict(fieldKey, scored) {
    const rule = this.engine.getFieldRule(fieldKey);
    const top = scored[0];
    const runner = scored[1];

    // Numeric tolerance check
    if (rule.data_type === 'number' || rule.data_type === 'integer') {
      const diff = Math.abs(Number(top.value) - Number(runner.value));
      const tolerance = Math.abs(Number(top.value)) * 0.05; // 5%
      if (diff <= tolerance) {
        // Within tolerance — prefer higher-tier source
        return {
          value: top.value,
          confidence: 0.85,
          candidates: scored,
          agreement: 'within_tolerance',
          selected_reason: `Values within 5% tolerance. Selected ${top.source?.tier} value.`
        };
      }
    }

    // Source-dependent field — keep ALL candidates
    if (rule.source_dependent) {
      return {
        value: top.value,
        confidence: 0.70,
        candidates: scored,
        agreement: 'source_dependent',
        selected_reason: 'Source-dependent field — all candidates preserved for review',
        needs_review: true
      };
    }

    // Irreconcilable conflict — flag for review
    if (top.composite_score - runner.composite_score < 0.1) {
      return {
        value: top.value,
        confidence: 0.50,
        candidates: scored,
        agreement: 'conflict',
        selected_reason: 'Conflicting sources with similar authority — needs human review',
        needs_review: true
      };
    }

    // Clear winner
    return {
      value: top.value,
      confidence: top.composite_score,
      candidates: scored,
      agreement: 'winner_clear',
      selected_reason: `${top.source?.tier} via ${top.extraction_method} is highest-scored`
    };
  }
}
```

---

## OPEN-SOURCE TOOLS & PLUGINS

### Required

| Tool | Purpose | Install |
|------|---------|---------|
| **@instructor-ai/instructor** | Structured LLM output with schema validation | `npm install @instructor-ai/instructor` |
| **Zod** | Schema definitions for LLM output | `npm install zod` |
| **@google/generative-ai** | Gemini 2.0 Flash API client | `npm install @google/generative-ai` |
| **openai** | DeepSeek API (OpenAI-compatible) | `npm install openai` |
| **object-hash** | Content-addressed LLM caching | `npm install object-hash` |
| **string-similarity** | Fuzzy string matching for candidates | `npm install string-similarity` |
| **Fuse.js** | Fuzzy search for component matching | `npm install fuse.js` |
| **p-queue** | Concurrency control for LLM calls | `npm install p-queue` |
| **p-retry** | Retry with backoff for API failures | `npm install p-retry` |

### Recommended

| Tool | Purpose | Install |
|------|---------|---------|
| **LangSmith** | LLM call observability and debugging | Via LangChain SDK |
| **Braintrust** | LLM evaluation and monitoring | `npm install braintrust` |
| **tiktoken** | Token counting for context window management | `npm install tiktoken` |
| **json-repair** | Fix malformed JSON from LLM output | `npm install json-repair` |
| **Helicone** | LLM proxy for logging, caching, rate limits | Via proxy URL |

---

## ACCEPTANCE CRITERIA

1. ☐ Deterministic parser extracts ≥40% of fields from golden-file evidence
2. ☐ Component DB resolver auto-fills sensor properties (max_dpi, max_ips) when sensor name is extracted
3. ☐ Gemini Flash extraction works with Instructor-JS + Zod schemas
4. ☐ DeepSeek extraction works for conflict resolution tasks
5. ☐ Field batching produces ≤7 LLM calls per product (within budget)
6. ☐ LLM cache hit rate ≥30% on re-processed products
7. ☐ Every extracted value has a snippet_id citation
8. ☐ Candidate merger correctly resolves: unanimous, within_tolerance, source_dependent, conflict
9. ☐ Confidence scores are calibrated (high confidence = actually correct in golden files)
10. ☐ Total extraction cost ≤$0.15 per product (Gemini Flash + DeepSeek combined)
11. ☐ Total extraction time ≤60 seconds per product
12. ☐ Golden-file accuracy improves ≥5% over Phase 3 baseline (deterministic-only)
13. ☐ LLM prompt templates produce consistent structured output (no parse failures)
14. ☐ Conflict resolution correctly prefers manufacturer for physical specs, lab for measured data
