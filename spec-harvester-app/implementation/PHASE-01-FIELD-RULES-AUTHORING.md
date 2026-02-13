# PHASE 1 OF 10 — CATEGORY SCHEMA & FIELD RULES AUTHORING SYSTEM

## ROLE & CONTEXT

You are a senior systems architect building the **Field Rules Studio** — the authoring layer that defines the per-category "field contract" for a 24/7 evidence-first Spec Factory. This is Phase 1 of 10. Nothing else works until this is correct. Every downstream system (crawling, extraction, validation, publishing, human review) reads the artifacts this phase produces.

The Spec Factory must handle ANY consumer electronics category at extreme depth: gaming mice (154+ fields), monitors (200+ fields), keyboards (180+ fields), GPUs (160+ fields), CPUs (140+ fields), headsets, chairs, etc. The authoring system must be **category-agnostic** — the same tooling produces the same artifact shape regardless of category.

---

## MISSION (NON-NEGOTIABLE)

Build a 24/7, evidence-first "Spec Factory" that can publish 15–20 products per day with ~99% accuracy on expected fields by:
1. Authoring a strict per-category field contract via the Field Rules Studio (types/shapes/units/enums/components/parsing/evidence/priority) compiled into `helper_files/<category>/_generated/field_rules.json`
2. Running a multi-round web + helper-source pipeline that only accepts values with per-field citations (URL + snippet_id + quote) and outputs `unk` with reason codes when not provable
3. Using helper artifacts (known_values + component_db + curated targets) to increase speed and consistency
4. Providing a fast Data Review Grid that shows all candidate values and sources, lets you override selections without re-crawling, and feeds safe "suggestions" for new enums/components back into the control plane for approval

---

## WHAT THIS PHASE DELIVERS

### Primary Deliverable: The Category Schema Definition System

A tooling layer that allows a human author (or AI-assisted workflow) to define, for any product category:

1. **Field Catalog** — every field the system will attempt to collect
2. **Field Rules** — per-field contract (type, shape, unit, enum policy, parsing, evidence requirements, priority metadata)
3. **Component Databases** — curated lookup tables for complex fields (sensors, switches, panels, chipsets, etc.)
4. **Known Values** — canonical enum lists with alias maps
5. **Parse Templates** — per-field regex/pattern definitions for deterministic extraction
6. **Cross-Validation Rules** — inter-field consistency checks
7. **UI Field Catalog** — display metadata for the Data Review Grid

### Output Artifacts (per category)

```
helper_files/<category>/
├── _source/                          # AUTHORING FILES (human-editable)
│   ├── field_catalog.xlsx            # Master spreadsheet (one per category)
│   ├── component_db/                 # Component database spreadsheets
│   │   ├── sensors.xlsx              # (mouse) or panels.xlsx (monitor) etc.
│   │   ├── switches.xlsx
│   │   ├── encoders.xlsx
│   │   └── ...
│   └── overrides/                    # Manual corrections
├── _generated/                       # COMPILED ARTIFACTS (never hand-edit)
│   ├── field_rules.json              # ★ THE canonical field contract
│   ├── ui_field_catalog.json         # Display metadata for review grid
│   ├── known_values.json             # All enum values + alias maps
│   ├── parse_templates.json          # Per-field extraction patterns
│   ├── cross_validation_rules.json   # Inter-field consistency checks
│   ├── field_groups.json             # Logical groupings for UI + batching
│   ├── key_migrations.json           # Field rename/merge history
│   └── component_db/                 # Compiled component databases
│       ├── sensors.json
│       ├── switches.json
│       ├── encoders.json
│       └── ...
├── _suggestions/                     # Runtime suggestions (Phase 8–9)
└── _overrides/                       # Per-product overrides (Phase 8)
```

---

## DETAILED REQUIREMENTS

### 1. Field Catalog Schema

Every field in every category MUST have the following metadata. This is the **field_rules.json** schema:

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "description": "Per-category field rules — the canonical contract",
  "properties": {
    "category": { "type": "string" },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "generated_at": { "type": "string", "format": "date-time" },
    "field_count": { "type": "integer" },
    "fields": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/$defs/FieldRule"
      }
    }
  },
  "$defs": {
    "FieldRule": {
      "type": "object",
      "required": [
        "field_key", "display_name", "group", "data_type", "output_shape",
        "required_level", "availability", "difficulty", "effort",
        "evidence_required", "unknown_reason_default"
      ],
      "properties": {
        // ─── IDENTITY ───
        "field_key":        { "type": "string", "description": "Canonical snake_case key used in all outputs" },
        "display_name":     { "type": "string", "description": "Human-readable label for UI" },
        "description":      { "type": "string", "description": "What this field represents" },
        "group":            { "type": "string", "enum": ["identity","physical","sensor","switch","connectivity","performance","ergonomics","features","editorial","commerce","media"] },
        "subgroup":         { "type": "string", "description": "Optional finer grouping within group" },
        "sort_order":       { "type": "integer", "description": "Display order within group" },

        // ─── DATA TYPE & SHAPE ───
        "data_type":        { "type": "string", "enum": ["string","number","integer","boolean","date","url","enum","component_ref"] },
        "output_shape":     { "type": "string", "enum": ["scalar","list","structured","key_value"] },
        "list_separator":   { "type": "string", "description": "Delimiter when shape=list (e.g., ', ')" },
        "structured_schema":{ "type": "object", "description": "JSON Schema for shape=structured" },

        // ─── UNITS & NORMALIZATION ───
        "unit":             { "type": ["string","null"], "description": "Canonical unit (g, mm, ms, Hz, dpi, etc.)" },
        "unit_aliases":     { "type": "array", "items": { "type": "string" }, "description": "Alternate unit strings to normalize from" },
        "rounding":         { "type": "string", "enum": ["integer","1dp","2dp","3dp","none"], "default": "none" },
        "range_min":        { "type": ["number","null"], "description": "Plausibility floor" },
        "range_max":        { "type": ["number","null"], "description": "Plausibility ceiling" },
        "normalization_fn": { "type": ["string","null"], "description": "Named normalization function (e.g., 'strip_unit_suffix','parse_date_excel','parse_polling_list')" },

        // ─── ENUM POLICY ───
        "enum_policy":      { "type": ["string","null"], "enum": ["closed","open",null], "description": "closed=only known_values; open=allow new if evidence-backed" },
        "known_values_ref": { "type": ["string","null"], "description": "Key into known_values.json" },
        "component_db_ref": { "type": ["string","null"], "description": "Which component_db file to cross-reference" },
        "alias_map":        { "type": "object", "description": "Direct alias→canonical mappings", "additionalProperties": { "type": "string" } },

        // ─── PARSING ───
        "parse_patterns":   { "type": "array", "items": { "type": "string" }, "description": "Regex patterns for extraction (group 1 = value)" },
        "parse_context_keywords": { "type": "array", "items": { "type": "string" }, "description": "Keywords that indicate this field in source text" },
        "parse_negative_keywords": { "type": "array", "items": { "type": "string" }, "description": "Keywords that indicate NOT this field (disambiguation)" },

        // ─── PRIORITY & EFFORT ───
        "required_level":   { "type": "string", "enum": ["required","critical","expected","optional","editorial","commerce"] },
        "availability":     { "type": "string", "enum": ["expected","sometimes","rare","editorial_only"] },
        "difficulty":       { "type": "string", "enum": ["easy","medium","hard","instrumented"] },
        "effort":           { "type": "integer", "minimum": 1, "maximum": 10, "description": "Relative effort budget (1=trivial, 10=extreme)" },

        // ─── EVIDENCE ───
        "evidence_required":       { "type": "boolean", "description": "If true, value MUST have provenance" },
        "source_dependent":        { "type": "boolean", "default": false, "description": "If true, preserve all candidates per source" },
        "evidence_tier_preference": { "type": "array", "items": { "type": "string", "enum": ["tier1_manufacturer","tier2_lab","tier3_retailer","tier4_community","tier5_aggregator"] } },
        "preferred_source_hosts":  { "type": "array", "items": { "type": "string" }, "description": "Hostname preferences for this field" },

        // ─── CROSS-VALIDATION ───
        "cross_validate":   {
          "type": ["object","null"],
          "properties": {
            "against":      { "type": "string", "description": "component_db name" },
            "match_key":    { "type": "string" },
            "check_fields": { "type": "array", "items": { "type": "string" } }
          }
        },
        "depends_on":       { "type": "array", "items": { "type": "string" }, "description": "Fields that must be resolved first" },
        "conflicts_with":   { "type": "array", "items": { "type": "string" }, "description": "Fields that are mutually exclusive" },

        // ─── UNKNOWN HANDLING ───
        "unknown_reason_default": { "type": "string", "enum": [
          "not_found_after_search","not_publicly_disclosed","conflicting_sources_unresolved",
          "identity_ambiguous","blocked_by_robots_or_tos","parse_failure","budget_exhausted",
          "evidence_missing","source_dependent_review","editorial_not_generated"
        ]},

        // ─── CATEGORY-SPECIFIC FLAGS ───
        "category_specific": { "type": "object", "description": "Any category-specific metadata" }
      }
    }
  }
}
```

### 2. Component Database Schema

Component databases are curated lookup tables for complex fields. Each component DB must follow this schema:

```jsonc
{
  "db_name": "sensors",           // matches component_db_ref in field_rules
  "category": "mouse",
  "version": "1.0.0",
  "generated_at": "2026-02-12T00:00:00Z",
  "match_strategy": "fuzzy",      // exact | fuzzy | alias_first
  "entries": {
    "PAW3395": {
      "canonical_name": "PAW3395",
      "brand": "PixArt",
      "aliases": ["3395", "paw3395", "PAW3395DM-T6QU", "pixart 3395"],
      "properties": {
        "sensor_type": "optical",
        "max_dpi": 26000,
        "max_ips": 650,
        "max_acceleration": 50,
        "flawless": true,
        "release_date": "2022-03-01"
      },
      "validation_rules": {
        "dpi_must_not_exceed": 26000,
        "ips_must_not_exceed": 650
      },
      "link": "https://www.pixart.com/products-detail/129/PAW3395DM-T6QU"
    }
    // ... more entries
  }
}
```

**Required component DBs per category:**

| Category | Component DBs |
|----------|--------------|
| mouse | sensors, switches, encoders, materials, mcu_chips |
| monitor | panels, panel_types, backlights, scalers, stand_types |
| keyboard | switches, keycaps, stabilizers, controllers, plate_materials |
| gpu | gpu_chips, memory_types, cooler_types, power_connectors |
| cpu | architectures, sockets, chipsets, cooler_compatibilities |
| headset | drivers, codecs, microphone_types, pad_materials |

### 3. Known Values Schema

```jsonc
{
  "category": "mouse",
  "version": "1.0.0",
  "generated_at": "2026-02-12T00:00:00Z",
  "enums": {
    "form_factor": {
      "policy": "closed",
      "values": [
        {
          "canonical": "right",
          "aliases": ["right-handed", "right hand", "rh", "ergonomic right"],
          "description": "Right-handed ergonomic shape"
        },
        {
          "canonical": "ambidextrous",
          "aliases": ["ambi", "symmetrical", "symmetric", "both hands"],
          "description": "Symmetrical ambidextrous shape"
        },
        {
          "canonical": "left",
          "aliases": ["left-handed", "left hand", "lh"],
          "description": "Left-handed ergonomic shape"
        }
      ]
    },
    "connection": {
      "policy": "closed",
      "values": [
        { "canonical": "wired", "aliases": ["usb wired", "cable only", "wired only"] },
        { "canonical": "wireless", "aliases": ["wireless only", "rf wireless"] },
        { "canonical": "hybrid", "aliases": ["wired/wireless", "dual mode", "wired and wireless", "tri-mode"] },
        { "canonical": "bluetooth", "aliases": ["bt only", "bluetooth only"] }
      ]
    },
    "coating": {
      "policy": "open",
      "values": [
        { "canonical": "matte", "aliases": ["matte finish", "matte coating"] },
        { "canonical": "glossy", "aliases": ["gloss", "glossy finish"] },
        { "canonical": "rubber grips", "aliases": ["rubberized", "rubber coating", "rubber grip"] },
        { "canonical": "textured", "aliases": ["textured finish", "grip texture"] }
      ]
    }
    // ... all enums for category
  }
}
```

### 4. Parse Templates Schema

```jsonc
{
  "category": "mouse",
  "version": "1.0.0",
  "templates": {
    "weight": {
      "patterns": [
        { "regex": "(\\d+\\.?\\d*)\\s*g(?:rams)?(?:\\s|$|,|;)", "group": 1, "unit": "g" },
        { "regex": "weight[:\\s]+(\\d+\\.?\\d*)\\s*g", "group": 1, "unit": "g" },
        { "regex": "(\\d+\\.?\\d*)\\s*oz", "group": 1, "unit": "oz", "convert": "oz_to_g" },
        { "regex": "(?:weighs?|mass)[:\\s]+(\\d+\\.?\\d*)", "group": 1, "unit": "g" }
      ],
      "context_window": 200,
      "context_keywords": ["weight", "mass", "weighs", "grams"],
      "negative_keywords": ["shipping weight", "package weight", "box weight"],
      "post_process": "round_integer"
    },
    "polling_rate": {
      "patterns": [
        { "regex": "(\\d[\\d,]*(?:\\s*/\\s*\\d[\\d,]*)*)\\s*Hz", "group": 1, "unit": "Hz" },
        { "regex": "polling[\\s:]+rate[:\\s]+(\\d[\\d,/\\s]*?)\\s*Hz", "group": 1, "unit": "Hz" },
        { "regex": "report[\\s:]+rate[:\\s]+(\\d+)", "group": 1, "unit": "Hz" }
      ],
      "list_parse": {
        "separators": [",", "/", " / ", " and "],
        "sort": "descending",
        "dedupe": true
      },
      "context_keywords": ["polling", "report rate", "Hz", "response rate"],
      "negative_keywords": ["refresh rate", "monitor"],
      "post_process": "parse_polling_list"
    },
    "dpi": {
      "patterns": [
        { "regex": "(\\d[\\d,]*)\\s*(?:DPI|dpi|CPI|cpi)", "group": 1, "unit": "dpi" },
        { "regex": "(?:max|maximum|up to)\\s*(\\d[\\d,]*)\\s*(?:DPI|dpi)", "group": 1, "unit": "dpi" },
        { "regex": "sensitivity[:\\s]+(\\d[\\d,]*)\\s*(?:DPI|dpi)", "group": 1, "unit": "dpi" }
      ],
      "context_keywords": ["DPI", "CPI", "sensitivity", "resolution"],
      "negative_keywords": ["monitor dpi", "screen dpi", "print dpi"],
      "post_process": "strip_commas_to_integer"
    }
    // ... all fields
  }
}
```

### 5. Cross-Validation Rules

```jsonc
{
  "category": "mouse",
  "rules": [
    {
      "rule_id": "sensor_dpi_consistency",
      "description": "Claimed DPI must not exceed sensor's max DPI",
      "trigger_field": "dpi",
      "depends_on": ["sensor"],
      "check": {
        "type": "component_db_lookup",
        "db": "sensors",
        "lookup_field": "sensor",
        "compare": "dpi <= sensors[sensor].properties.max_dpi",
        "on_fail": "flag_for_review",
        "tolerance_percent": 5
      }
    },
    {
      "rule_id": "wireless_battery_required",
      "description": "Wireless mice must have battery_hours or be flagged",
      "trigger_field": "connection",
      "condition": "connection IN ['wireless','hybrid']",
      "requires_field": "battery_hours",
      "on_fail": "set_unknown_with_reason",
      "unknown_reason": "not_found_after_search"
    },
    {
      "rule_id": "weight_plausibility",
      "description": "Weight must be plausible for category",
      "trigger_field": "weight",
      "check": {
        "type": "range",
        "min": 30,
        "max": 200,
        "on_fail": "reject_candidate"
      }
    },
    {
      "rule_id": "dimensions_consistency",
      "description": "All three dimensions should be present together",
      "trigger_field": "length",
      "related_fields": ["width", "height"],
      "check": {
        "type": "group_completeness",
        "minimum_present": 3,
        "on_fail": "flag_for_review"
      }
    }
  ]
}
```

---

## OPEN-SOURCE TOOLS & PLUGINS FOR THIS PHASE

### Required

| Tool | Purpose | Install |
|------|---------|---------|
| **ExcelJS** | Read/write .xlsx/.xlsm for authoring | `npm install exceljs` |
| **AJV** | JSON Schema validation for all generated artifacts | `npm install ajv ajv-formats` |
| **Zod** | Runtime TypeScript/JS schema validation | `npm install zod` |
| **zod-to-json-schema** | Generate JSON Schema from Zod for docs | `npm install zod-to-json-schema` |
| **fast-glob** | File discovery across category directories | `npm install fast-glob` |
| **chalk** | CLI output formatting | `npm install chalk` |
| **Inquirer.js** | Interactive CLI prompts for authoring | `npm install @inquirer/prompts` |
| **diff** | Show diffs when regenerating artifacts | `npm install diff` |

### Recommended

| Tool | Purpose | Install |
|------|---------|---------|
| **json-schema-to-zod** | Bidirectional schema conversion | `npm install json-schema-to-zod` |
| **fastest-validator** | Lightweight alternative to AJV | `npm install fastest-validator` |
| **xlsx-populate** | Alternative Excel library with macro support | `npm install xlsx-populate` |
| **Fuse.js** | Fuzzy matching for alias resolution | `npm install fuse.js` |
| **string-similarity** | Dice coefficient for alias matching | `npm install string-similarity` |

---

## IMPLEMENTATION DETAILS

### File: `src/field-rules/compiler.js`

This is the core compilation module. It reads authoring files and produces all `_generated/` artifacts.

```
COMPILER PIPELINE:
1. readFieldCatalog(categoryPath)         → raw field definitions
2. readComponentDBs(categoryPath)         → component database entries
3. validateFieldCatalog(raw, componentDBs) → errors[] or clean catalog
4. generateFieldRules(catalog)            → field_rules.json
5. generateKnownValues(catalog)           → known_values.json
6. generateParseTemplates(catalog)        → parse_templates.json
7. generateCrossValidation(catalog)       → cross_validation_rules.json
8. generateUIFieldCatalog(catalog)        → ui_field_catalog.json
9. generateFieldGroups(catalog)           → field_groups.json
10. compileComponentDBs(rawDBs)           → component_db/*.json
11. writeAllArtifacts(generated, outputDir)
12. validateAllArtifacts(outputDir)       → integrity check
```

### File: `src/field-rules/loader.js`

Runtime loading module used by ALL downstream systems:

```javascript
// This is the ONLY way to access field rules at runtime
// CLI, daemon, GUI, orchestrator ALL use this module

loadFieldRules(category)           → { rules, knownValues, componentDBs, parseTemplates, crossValidation }
getFieldRule(category, fieldKey)    → FieldRule | null
getKnownValues(category, enumRef)  → { policy, values[] }
lookupComponent(category, dbName, query) → ComponentEntry | null
getParseTemplate(category, fieldKey) → ParseTemplate | null
getCrossValidationRules(category)  → CrossValidationRule[]
```

### CLI Commands

```bash
# Compile all artifacts for a category
node src/cli/spec.js compile-rules --category mouse

# Validate existing artifacts without recompiling
node src/cli/spec.js validate-rules --category mouse

# Show diff between current artifacts and what would be generated
node src/cli/spec.js compile-rules --category mouse --dry-run

# Initialize a new category from a template
node src/cli/spec.js init-category --category monitor --template electronics

# List all fields and their metadata for a category
node src/cli/spec.js list-fields --category mouse [--group sensor] [--required-level critical]

# Export field rules to a human-readable report
node src/cli/spec.js field-report --category mouse --format md
```

---

## MULTI-CATEGORY ARCHITECTURE

The system MUST be category-agnostic. Here's how categories share infrastructure:

```
categories/
├── _shared/                          # Shared across all categories
│   ├── base_field_schema.json        # The FieldRule JSON Schema above
│   ├── base_component_schema.json    # Component DB base schema
│   ├── normalization_functions.js    # Shared normalization (unit conversion, etc.)
│   ├── common_parse_patterns.json    # Patterns that work across categories
│   └── common_enums.json            # Shared enums (yes/no, colors, materials)
│
├── mouse/
│   ├── schema.json                   # Category config (existing)
│   ├── sources.json                  # Source tiers (existing)
│   ├── required_fields.json          # Required fields (migrates to field_rules)
│   ├── search_templates.json         # Search query templates
│   └── anchors.json                  # Identity anchors
│
├── monitor/
│   ├── schema.json
│   ├── sources.json
│   └── ...
│
└── keyboard/
    └── ...

helper_files/
├── mouse/
│   ├── _source/                      # Authoring files
│   └── _generated/                   # Compiled artifacts
├── monitor/
│   ├── _source/
│   └── _generated/
└── keyboard/
    ├── _source/
    └── _generated/
```

### Category Template for New Categories

When initializing a new category, the system generates a starter `field_catalog.xlsx` with:

1. **Identity group** (always the same): brand, model, variant, base_model, sku, mpn, gtin, category
2. **Physical group** (common): weight, length, width, height, material, color
3. **Connectivity group** (common): connection, wireless_technology, cable_type, cable_length
4. **Performance group** (category-specific): starts empty, author fills in
5. **Features group** (category-specific): starts empty
6. **Editorial group** (always the same): overall_score, pros, cons, verdict, key_takeaway
7. **Commerce group** (always the same): price_range, affiliate links, images
8. **Media group** (always the same): youtube_url, feature_image, gallery images

---

## ACCEPTANCE CRITERIA

1. ☐ `node src/cli/spec.js compile-rules --category mouse` produces all 8 `_generated/` artifacts
2. ☐ All generated JSON passes AJV validation against the schemas defined above
3. ☐ `field_rules.json` contains ALL 154 mouse fields with complete metadata
4. ☐ `known_values.json` contains all enums from data_lists with alias maps
5. ☐ `component_db/sensors.json` contains all 124 sensors with aliases and cross-validation properties
6. ☐ `component_db/switches.json` contains all 114 switches
7. ☐ `component_db/encoders.json` contains all 46 encoders
8. ☐ `parse_templates.json` has patterns for at least all `required` and `critical` fields
9. ☐ `cross_validation_rules.json` has at least 10 inter-field rules
10. ☐ `loadFieldRules('mouse')` returns a fully-typed object usable by downstream systems
11. ☐ `node src/cli/spec.js init-category --category monitor --template electronics` creates valid starter artifacts
12. ☐ Compilation is idempotent — running twice produces identical output
13. ☐ Round-trip test: compile → load → re-compile produces identical JSON
14. ☐ Every field has `required_level`, `availability`, `difficulty`, `effort` populated (no nulls on required metadata)
15. ☐ README updated with field rules documentation

---

## WHAT PHASE 2 EXPECTS FROM THIS PHASE

Phase 2 (Artifact Compilation Pipeline) will:
- Read `_source/` files and invoke the compiler
- Set up file watchers for hot-reload during authoring
- Build CI/CD checks that validate artifacts on every commit
- Generate TypeScript/Zod types from field_rules.json for IDE autocomplete

Phase 2 REQUIRES that this phase delivers:
- A working `compiler.js` module
- A working `loader.js` module
- Complete `field_rules.json` for at least the `mouse` category
- The JSON Schema definitions above as `.json` files in `categories/_shared/`
