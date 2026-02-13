# PHASE 2 OF 10 — ARTIFACT COMPILATION PIPELINE & VALIDATION TOOLCHAIN

## ROLE & CONTEXT

You are a senior build-systems engineer. Phase 1 defined the schema for field rules and authored the first category (mouse). This phase builds the **automated compilation pipeline** that transforms human-editable authoring files into deterministic, validated runtime artifacts. Think of this as the "build system" for your data contracts — analogous to how a compiler turns source code into executables.

This phase also establishes the **golden-file testing framework** that every subsequent phase depends on for quality assurance. Without this, you cannot measure accuracy.

**Dependencies:** Phase 1 must be complete (compiler.js, loader.js, field_rules schema, mouse category artifacts).

---

## MISSION (NON-NEGOTIABLE — SAME ACROSS ALL PHASES)

Build a 24/7, evidence-first "Spec Factory" that can publish 15–20 products per day with ~99% accuracy on expected fields by:
1. Authoring a strict per-category field contract via the Field Rules Studio
2. Running a multi-round web + helper-source pipeline with per-field citations
3. Using helper artifacts (known_values + component_db + curated targets) for speed/consistency
4. Providing a fast Data Review Grid with overrides and suggestion feedback

---

## WHAT THIS PHASE DELIVERS

### Deliverable 2A: Compilation CLI & Watch Mode

A robust CLI that compiles authoring sources into runtime artifacts with:
- Full validation at every step
- Diff output showing what changed
- Watch mode for live authoring feedback
- Dry-run mode for CI/CD checks
- Multi-category batch compilation

### Deliverable 2B: Golden-File Testing Framework

A testing infrastructure that:
- Stores known-correct products as test fixtures
- Runs field_rules validation against every fixture
- Computes per-field accuracy metrics
- Detects regressions when field rules change
- Generates accuracy reports

### Deliverable 2C: Schema Versioning & Migrations

A migration system that:
- Tracks field_rules.json version changes
- Auto-generates key_migrations.json when fields are renamed/merged/split
- Validates that existing product data is compatible with new rules
- Provides upgrade scripts for breaking changes

### Deliverable 2D: TypeScript/Zod Type Generation

Auto-generated type definitions from field_rules.json that:
- Provide IDE autocomplete for field keys
- Enable compile-time type checking
- Generate Zod schemas for runtime validation in downstream phases
- Export types for the GUI (Phase 8)

---

## DETAILED IMPLEMENTATION

### 2A: Compilation Pipeline

#### File: `src/build/compile-category.js`

```
COMPILATION STAGES (in order):

Stage 1: DISCOVER
  - Scan helper_files/<category>/_source/ for authoring files
  - Validate file presence (field_catalog.xlsx required)
  - Detect component_db/ spreadsheets
  - Read existing _generated/ artifacts for diffing

Stage 2: PARSE
  - Read field_catalog.xlsx using ExcelJS
    - Sheet "fields": field_key, display_name, group, data_type, output_shape, unit, etc.
    - Sheet "enums": enum_name, canonical_value, aliases (comma-separated)
    - Sheet "parse_patterns": field_key, regex, group_index, unit, convert_fn
    - Sheet "cross_validation": rule_id, trigger_field, condition, check_type, etc.
    - Sheet "metadata": category, version, author, notes
  - Read component_db/*.xlsx files
    - Each sheet = one component type
    - Columns match component_db schema from Phase 1
  - Merge with categories/_shared/common_enums.json and common_parse_patterns.json

Stage 3: VALIDATE SOURCE
  - Every field_key must be unique
  - Every field must have all required metadata
  - Every enum reference must point to a defined enum
  - Every component_db_ref must point to an existing component DB
  - Every parse_pattern must be a valid regex
  - Every cross-validation rule must reference existing fields
  - Range checks: range_min < range_max, effort in 1-10, etc.
  - Produce structured error report if any fail

Stage 4: TRANSFORM
  - Normalize all field keys to snake_case
  - Expand alias strings into arrays
  - Convert Excel dates to ISO-8601
  - Build alias lookup maps (reverse index: alias → canonical)
  - Compute derived fields (e.g., field_count)
  - Resolve shared enums/patterns from _shared/

Stage 5: GENERATE
  - Produce all 8+ artifact files:
    field_rules.json, known_values.json, parse_templates.json,
    cross_validation_rules.json, ui_field_catalog.json,
    field_groups.json, key_migrations.json, component_db/*.json

Stage 6: VALIDATE OUTPUT
  - Every generated JSON must pass its AJV schema
  - Round-trip check: load generated → serialize → compare (byte-identical)
  - Cross-reference check: every ref in field_rules exists in known_values/component_db
  - Hash all artifacts and write manifest.json

Stage 7: DIFF & REPORT
  - Compare against previous _generated/ artifacts
  - Show added/removed/changed fields
  - Show added/removed enum values
  - Show added/removed component entries
  - Warn on breaking changes (field removals, type changes)
  - Write compilation report to _generated/_compilation_report.json

Stage 8: WRITE
  - Atomic write: generate to temp dir, validate, then swap
  - Preserve previous version as _generated/_previous/
  - Write manifest.json with hashes and timestamps
```

#### Watch Mode

```javascript
// File watcher for live authoring
// When any file in _source/ changes:
// 1. Debounce 500ms (author may be saving multiple files)
// 2. Run full compilation pipeline
// 3. Show diff in terminal
// 4. If errors, show inline with file/line references
// 5. If success, show summary of changes

// Implementation: use chokidar for file watching
// npm install chokidar
```

#### CLI Commands (additions to spec.js)

```bash
# Full compilation with validation
node src/cli/spec.js compile-rules --category mouse

# Compile all categories
node src/cli/spec.js compile-rules --all

# Watch mode (recompile on change)
node src/cli/spec.js compile-rules --category mouse --watch

# Dry run (show what would change, don't write)
node src/cli/spec.js compile-rules --category mouse --dry-run

# Validate only (check existing artifacts)
node src/cli/spec.js validate-rules --category mouse

# Show compilation report
node src/cli/spec.js compile-report --category mouse

# Diff current vs previous
node src/cli/spec.js rules-diff --category mouse
```

---

### 2B: Golden-File Testing Framework

This is **critical for achieving 99% accuracy**. You have 343 manually-verified products. That's your ground truth.

#### File: `src/testing/golden-files.js`

```
GOLDEN FILE STRUCTURE:

fixtures/golden/<category>/
├── manifest.json              # Lists all golden products + metadata
├── <product-id>/
│   ├── expected.json          # Ground-truth field values
│   ├── identity.json          # Brand/model/variant
│   ├── source_evidence/       # Cached source pages (optional, for replay)
│   │   ├── manufacturer.html
│   │   ├── rtings.html
│   │   └── ...
│   └── notes.md              # Human notes about edge cases
```

#### Expected.json Schema

```jsonc
{
  "product_id": "mouse-razer-viper-v3-pro",
  "category": "mouse",
  "identity": {
    "brand": "Razer",
    "model": "Viper V3 Pro",
    "variant": "Wireless"
  },
  "fields": {
    "weight": { "value": 54, "confidence": "verified", "source": "manufacturer" },
    "sensor": { "value": "Focus Pro 26K V2", "confidence": "verified", "source": "manufacturer" },
    "dpi": { "value": 35000, "confidence": "verified", "source": "manufacturer" },
    "polling_rate": { "value": "8000, 4000, 2000, 1000", "confidence": "verified", "source": "manufacturer" },
    "connection": { "value": "hybrid", "confidence": "verified", "source": "manufacturer" },
    "click_latency": { "value": 0.2, "confidence": "lab_measured", "source": "rtings.com" },
    "switch": { "value": "Razer Gen-3 Optical", "confidence": "verified", "source": "manufacturer" }
    // ... all fields with known values
  },
  "expected_unknowns": {
    "shift_latency": "not_publicly_disclosed",
    "encoder_brand": "not_found_after_search"
  }
}
```

#### Golden-File CLI Commands

```bash
# Create golden file from existing Excel data
node src/cli/spec.js create-golden --category mouse --product-id mouse-razer-viper-v3-pro

# Batch-create golden files from Excel (first N products)
node src/cli/spec.js create-golden --category mouse --from-excel --count 50

# Run golden-file validation (field rules only — no crawling)
node src/cli/spec.js test-golden --category mouse

# Run golden-file benchmark (full pipeline against cached evidence)
node src/cli/spec.js benchmark-golden --category mouse [--max-cases 10]

# Generate accuracy report
node src/cli/spec.js accuracy-report --category mouse --format md

# Compare two runs
node src/cli/spec.js accuracy-diff --run1 <runId1> --run2 <runId2>
```

#### Accuracy Metrics Computed

```jsonc
{
  "category": "mouse",
  "run_id": "benchmark-2026-02-12",
  "products_tested": 50,
  "overall_accuracy": 0.934,      // fields correct / fields expected
  "overall_coverage": 0.891,      // fields non-unk / fields expected
  "by_required_level": {
    "required":  { "accuracy": 0.99, "coverage": 0.99, "fields": 4 },
    "critical":  { "accuracy": 0.96, "coverage": 0.95, "fields": 12 },
    "expected":  { "accuracy": 0.92, "coverage": 0.87, "fields": 45 },
    "optional":  { "accuracy": 0.85, "coverage": 0.62, "fields": 30 }
  },
  "by_group": {
    "identity":     { "accuracy": 0.99, "coverage": 0.99 },
    "physical":     { "accuracy": 0.96, "coverage": 0.94 },
    "sensor":       { "accuracy": 0.94, "coverage": 0.92 },
    "switch":       { "accuracy": 0.88, "coverage": 0.82 },
    "connectivity": { "accuracy": 0.97, "coverage": 0.96 },
    "performance":  { "accuracy": 0.78, "coverage": 0.71 }
  },
  "by_field": {
    "weight":       { "correct": 48, "incorrect": 1, "unknown": 1, "accuracy": 0.96 },
    "sensor":       { "correct": 46, "incorrect": 2, "unknown": 2, "accuracy": 0.92 },
    "click_latency":{ "correct": 32, "incorrect": 3, "unknown": 15, "accuracy": 0.64 }
    // ... every field
  },
  "common_failures": [
    { "field": "click_latency", "reason": "source_dependent — RTINGS vs manufacturer differ", "count": 8 },
    { "field": "switch", "reason": "alias_not_in_known_values", "count": 5 },
    { "field": "encoder_brand", "reason": "not_publicly_disclosed", "count": 12 }
  ]
}
```

---

### 2C: Schema Versioning & Migrations

#### File: `src/field-rules/migrations.js`

```
VERSION FORMAT: semver (major.minor.patch)

MAJOR: Breaking change (field removed, type changed, enum policy changed)
MINOR: New field added, new enum values, new component entries  
PATCH: Alias added, parse pattern improved, description changed

MIGRATION FILE: key_migrations.json
{
  "version": "1.1.0",
  "previous_version": "1.0.0",
  "migrations": [
    {
      "type": "rename",
      "from": "mouse_side_connector",
      "to": "device_side_connector",
      "reason": "Generalize for multi-category"
    },
    {
      "type": "merge",
      "from": ["sensor_latency", "sensor_latency_list"],
      "to": "sensor_latency",
      "shape_change": "scalar → structured",
      "reason": "Consolidate latency data"
    },
    {
      "type": "split",
      "from": "connection",
      "to": ["connection_type", "wireless_technology"],
      "reason": "Separate wired/wireless from specific tech"
    },
    {
      "type": "deprecate",
      "field": "paracord",
      "reason": "Merged into cable_type enum",
      "replacement": "cable_type = paracord"
    }
  ]
}
```

When loading existing product data, `applyKeyMigrations(record)` transforms old keys to new:

```javascript
function applyKeyMigrations(record, migrations) {
  for (const m of migrations.migrations) {
    switch (m.type) {
      case 'rename':
        if (m.from in record) {
          record[m.to] = record[m.from];
          delete record[m.from];
        }
        break;
      case 'merge': /* ... */ break;
      case 'split': /* ... */ break;
      case 'deprecate':
        if (m.field in record) {
          record._deprecated = record._deprecated || {};
          record._deprecated[m.field] = record[m.field];
          delete record[m.field];
        }
        break;
    }
  }
  return record;
}
```

---

### 2D: Type Generation

#### File: `src/build/generate-types.js`

Generate Zod schemas and TypeScript types from field_rules.json:

```javascript
// Input: field_rules.json
// Output: src/generated/mouse.types.ts, src/generated/mouse.schema.ts

// For each field, generate a Zod validator:
// weight: z.number().int().min(30).max(200)
// sensor: z.string() (with refinement from known_values)
// connection: z.enum(["wired","wireless","hybrid","bluetooth"])
// polling_rate: z.string().regex(/^\d+(, \d+)*$/)
// click_latency: z.number().min(0).max(100).optional()

// Generate composite schema:
// MouseSpec = z.object({ weight: ..., sensor: ..., ... })
// MouseSpecPartial = MouseSpec.partial() // for intermediate extraction
```

This enables:
- IDE autocomplete when writing extraction code
- Compile-time field key validation
- Runtime validation with helpful error messages
- GUI type safety (Phase 8)

---

## OPEN-SOURCE TOOLS & PLUGINS

### Required for This Phase

| Tool | Purpose | Install |
|------|---------|---------|
| **ExcelJS** | Read authoring .xlsx files | `npm install exceljs` |
| **AJV + ajv-formats** | JSON Schema validation | `npm install ajv ajv-formats` |
| **Zod** | Runtime schema validation | `npm install zod` |
| **zod-to-json-schema** | Export Zod → JSON Schema | `npm install zod-to-json-schema` |
| **chokidar** | File watcher for watch mode | `npm install chokidar` |
| **diff** | Artifact diffing | `npm install diff` |
| **chalk** | CLI colored output | `npm install chalk` |
| **ora** | CLI spinners | `npm install ora` |
| **table** | CLI table output for reports | `npm install table` |
| **glob** | File pattern matching | `npm install glob` |
| **semver** | Version comparison | `npm install semver` |
| **object-hash** | Content-addressed hashing for manifests | `npm install object-hash` |

### Recommended

| Tool | Purpose | Install |
|------|---------|---------|
| **ts-morph** | TypeScript AST manipulation for type generation | `npm install ts-morph` |
| **prettier** | Format generated code/JSON | `npm install prettier` |
| **Vitest** | Test runner for golden files | `npm install vitest` |
| **c8** | Code coverage | `npm install c8` |

---

## ACCEPTANCE CRITERIA

1. ☐ `compile-rules --category mouse` runs in <10 seconds and produces all artifacts
2. ☐ `compile-rules --all` works for every initialized category
3. ☐ `compile-rules --watch` detects file changes and recompiles within 1 second
4. ☐ `compile-rules --dry-run` shows diff without writing
5. ☐ `validate-rules` catches all schema violations with clear error messages
6. ☐ 50 golden files created from existing mouse Excel data
7. ☐ `test-golden --category mouse` validates all 50 fixtures against field_rules
8. ☐ `accuracy-report` produces field-level precision/recall metrics
9. ☐ key_migrations.json correctly transforms legacy field names
10. ☐ Generated Zod schemas match field_rules.json for all fields
11. ☐ Compilation is deterministic — same input always produces same output
12. ☐ manifest.json contains SHA-256 hashes for every generated artifact
13. ☐ _compilation_report.json shows added/removed/changed fields
14. ☐ All existing tests still pass (`npm test`)
15. ☐ Watch mode works on Windows (chokidar) and Linux

---

## WHAT PHASE 3 EXPECTS

Phase 3 (Field Rules Runtime Engine) will:
- Call `loadFieldRules(category)` for every pipeline run
- Use Zod schemas for input/output validation
- Use parse_templates for deterministic extraction
- Use component_db for cross-validation
- Use known_values for enum enforcement
- Rely on golden files for regression testing

Phase 3 REQUIRES:
- Fully working loader.js with all artifact types
- Generated Zod schemas for at least the mouse category
- At least 50 golden files with verified field values
- A working benchmark command that reports accuracy
