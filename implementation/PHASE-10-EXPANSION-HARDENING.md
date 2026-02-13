# PHASE 10 OF 10 — MULTI-CATEGORY EXPANSION, INTEGRATION TESTING & PRODUCTION HARDENING

## ROLE & CONTEXT

You are a senior staff engineer responsible for taking a working prototype to production-grade reliability. Phases 1–9 built the complete Spec Factory for the `mouse` category. This final phase proves the system is **category-agnostic** by expanding to at least 2 additional categories (monitor + keyboard), builds comprehensive end-to-end integration tests, and hardens every component for 24/7 unattended operation.

This is the "prove it works at scale" phase. The mouse category is your proof-of-concept. If the same pipeline, the same FieldRulesEngine, the same Review Grid, the same publishing system works equally well for monitors and keyboards — each with completely different field sets, sources, and component databases — then the architecture is validated.

**Dependencies:** ALL Phases 1–9 must be complete and working for the `mouse` category.

---

## MISSION (NON-NEGOTIABLE — FINAL PHASE)

Build a 24/7, evidence-first "Spec Factory" that can publish 15–20 products per day with ~99% accuracy on expected fields by: (1) strict per-category field contracts, (2) multi-round web + helper-source pipeline with per-field citations, (3) helper artifacts for speed/consistency, (4) Data Review Grid with overrides.

**THIS PHASE PROVES** the system achieves this goal across MULTIPLE product categories, not just one.

---

## WHAT THIS PHASE DELIVERS

### Deliverable 10A: Monitor Category (Full Build-Out)

Complete the entire Phase 1–9 cycle for the `monitor` category:
- ~200 fields covering panel, backlight, HDR, connectivity, response times, calibration
- Component DBs: panels (IPS/VA/TN/OLED manufacturers), scalers, backlights, stand types
- Source registry: manufacturer sites, RTINGS monitors, TFTCentral, DisplaySpecifications.com
- 30 golden-file test fixtures from well-known monitors
- Full pipeline run producing published output

### Deliverable 10B: Keyboard Category (Full Build-Out)

Complete the entire Phase 1–9 cycle for the `keyboard` category:
- ~180 fields covering switches, keycaps, stabilizers, PCB, layout, features
- Component DBs: switches (Cherry/Gateron/Kailh/etc.), keycap profiles, stabilizers
- Source registry: manufacturer sites, RTINGS keyboards, keyboard review sites
- 30 golden-file test fixtures
- Full pipeline run producing published output

### Deliverable 10C: Comprehensive Integration Test Suite

End-to-end tests that:
- Run the COMPLETE pipeline for 10 products per category (30 total)
- Verify every stage: compile → crawl → identity → extract → validate → review → publish
- Compare output against golden files
- Measure accuracy, coverage, cost, and throughput
- Run in CI/CD (GitHub Actions / local)
- Detect regressions across ALL categories simultaneously

### Deliverable 10D: Production Hardening

Reliability improvements:
- Error recovery for every failure mode
- Data integrity checks (corrupted files, partial writes)
- Memory leak prevention for long-running daemon
- Disk space management (auto-cleanup of old evidence)
- API quota management (Gemini, DeepSeek rate limits)
- Comprehensive logging (structured JSON, log rotation)
- Health checks and self-healing
- Documentation (README, architecture docs, runbooks)

### Deliverable 10E: Performance Optimization

Speed and cost improvements:
- Parallel processing tuning (optimal concurrency per category)
- LLM cache warm-up (pre-cache common brand patterns)
- Incremental re-crawl (only fetch changed pages)
- Spec table template caching (brand-specific CSS selectors)
- Batch publishing (publish 20 products in one Excel file)
- Database indexing for SQLite output

---

## MONITOR CATEGORY — FIELD GROUPS

```
MONITOR FIELD GROUPS (~200 fields):

IDENTITY (8 fields):
  brand, model, variant, base_model, sku, mpn, gtin, release_date

PANEL (25 fields):
  panel_type (IPS/VA/TN/OLED), panel_manufacturer, panel_model,
  screen_size, resolution_horizontal, resolution_vertical, aspect_ratio,
  pixel_density, subpixel_layout, bit_depth, color_gamut_srgb,
  color_gamut_dci_p3, color_gamut_adobe_rgb, max_brightness_sdr,
  max_brightness_hdr, contrast_ratio_static, contrast_ratio_dynamic,
  viewing_angle_horizontal, viewing_angle_vertical, coating (matte/glossy/semi-glossy),
  curvature_radius, panel_technology_variant, pixel_response_gtg,
  pixel_response_mprt, backlight_type

HDR (8 fields):
  hdr_support, hdr_format (HDR10/HDR10+/Dolby Vision/HLG),
  hdr_peak_brightness, hdr_certification (DisplayHDR 400/600/1000),
  local_dimming_zones, local_dimming_type (edge/FALD/mini-LED),
  hdr_tone_mapping, hdr_metadata_support

REFRESH & RESPONSE (12 fields):
  max_refresh_rate, variable_refresh_rate (FreeSync/G-Sync),
  adaptive_sync_range_min, adaptive_sync_range_max,
  response_time_gtg, response_time_mprt, input_lag_60hz,
  input_lag_max_hz, overdrive_levels, overdrive_recommended,
  black_frame_insertion, motion_blur_reduction

CONNECTIVITY (15 fields):
  hdmi_ports, hdmi_version, displayport_ports, displayport_version,
  usb_c_ports, usb_c_power_delivery_watts, usb_c_displayport_alt,
  usb_hub_ports, usb_hub_version, headphone_jack,
  speaker_wattage, kvm_switch, daisy_chain_support,
  thunderbolt_ports, dvi_ports

PHYSICAL (12 fields):
  weight_with_stand, weight_without_stand, width, height_max,
  height_min, depth, vesa_mount, vesa_pattern,
  stand_tilt_range, stand_swivel_range, stand_height_adjustment,
  stand_pivot_rotation

ERGONOMICS (8 fields):
  osd_type (joystick/buttons/touch), osd_navigation_quality,
  cable_management, anti_glare, flicker_free,
  low_blue_light_mode, auto_brightness, ambient_light_sensor

GAMING FEATURES (10 fields):
  crosshair_overlay, fps_counter, black_equalizer,
  aim_stabilizer, gaming_presets, vrr_control_panel,
  nvidia_reflex_analyzer, motion_clarity_boost,
  instant_game_response, screen_size_selector

SOFTWARE & CALIBRATION (8 fields):
  osd_software, factory_calibrated, color_accuracy_delta_e,
  icc_profile_included, hardware_calibration_support,
  picture_modes_count, custom_picture_modes, firmware_updatable

COMMERCE (6 fields):
  msrp, street_price, availability, discontinued, warranty_years, amazon_asin

EDITORIAL (6 fields):
  overall_score, gaming_score, office_score, media_score, pros, cons

MEDIA (6 fields):
  feature_image_url, youtube_review_url, gallery_image_urls, press_kit_url,
  unboxing_video_url, comparison_chart_url
```

### Monitor Component DBs

```
PANELS DATABASE:
  Entries: LG Display IPS panels, Samsung VA panels, BOE IPS/VA, 
           AUO panels, Sharp IGZO, LG OLED (WOLED), Samsung QD-OLED
  Properties: panel_model, type (IPS/VA/TN/OLED), size_inches, 
              resolution, max_refresh, bit_depth, response_time_spec,
              manufacturer_code, used_in_monitors[]

SCALERS DATABASE:
  Entries: Realtek, MediaTek, Novatek scaler ICs
  Properties: model, max_resolution, max_refresh, hdmi_version_support,
              dp_version_support, vrr_support, hdr_support

BACKLIGHTS DATABASE:
  Entries: Edge-lit LED, Direct-lit LED, Mini-LED (with zone counts),
           OLED (self-emissive), QD-OLED, Dual-Layer LCD
  Properties: type, typical_zones, max_brightness_typical,
              dimming_capability, hdr_performance_tier
```

### Monitor Source Registry

```
TIER 1 — MANUFACTURERS:
  Dell/Alienware: dell.com/support/specifications
  LG: lg.com/monitors/specs
  Samsung: samsung.com/monitors/specs
  ASUS: asus.com/monitors/specs
  Acer: acer.com/monitors/specs
  BenQ: benq.com/monitors/specs
  MSI: msi.com/monitors/specs
  ViewSonic: viewsonic.com/monitors/specs
  Gigabyte: gigabyte.com/monitors/specs

TIER 2 — LABS:
  RTINGS: rtings.com/monitor/reviews/*
  TFTCentral: tftcentral.co.uk/reviews/*
  Hardware Unboxed: (YouTube + written — limited structured data)
  Monitors Unboxed: (YouTube + community data)
  PCMonitors.info: pcmonitors.info/reviews/*

TIER 3 — RETAILERS:
  Amazon: Product listings
  BestBuy: Product specifications
  B&H Photo: Detailed spec sheets
  Newegg: Product specifications

TIER 4 — AGGREGATORS:
  DisplaySpecifications.com: Comprehensive spec database
  Versus.com: Comparison data
  PCPartPicker: Pricing + basic specs
  PanelLook.com: Panel database (cross-reference)
```

---

## KEYBOARD CATEGORY — FIELD GROUPS

```
KEYBOARD FIELD GROUPS (~180 fields):

IDENTITY (8 fields):
  brand, model, variant, base_model, sku, mpn, gtin, release_date

SWITCHES (20 fields):
  switch_brand, switch_model, switch_type (linear/tactile/clicky),
  switch_actuation_force, switch_bottom_out_force, switch_actuation_point,
  switch_total_travel, switch_pre_travel, switch_rated_actuations,
  switch_factory_lubed, hot_swappable, hot_swap_socket_type,
  switch_pins (3-pin/5-pin), optical_switch, hall_effect_switch,
  magnetic_switch, adjustable_actuation, rapid_trigger,
  rapid_trigger_sensitivity, switch_alternatives_included

KEYCAPS (10 fields):
  keycap_material (ABS/PBT/POM), keycap_profile (Cherry/OEM/SA/DSA/MT3/XDA),
  keycap_legends (doubleshot/dyesub/laser/pad_printed), keycap_thickness,
  keycap_shine_through, keycap_replaceable, keycap_puller_included,
  keycap_colorway, supplementary_keycaps, keycap_sound_profile

LAYOUT (12 fields):
  layout_size (full/TKL/75%/65%/60%/40%),
  layout_standard (ANSI/ISO/JIS), total_keys,
  function_row, navigation_cluster, numpad,
  arrow_keys, media_keys_dedicated, macro_keys,
  programmable_keys, layout_variant (split/ortho/alice/standard),
  gasket_mount

BUILD (15 fields):
  case_material, plate_material (aluminum/PC/FR4/brass/steel),
  mounting_style (tray/gasket/top-mount/sandwich/integrated_plate),
  weight, length, width, height, typing_angle,
  adjustable_feet, feet_levels, cable_routing,
  foam_dampening, silicone_dampening, tape_mod_friendly,
  pcb_flex_cuts

CONNECTIVITY (10 fields):
  connection_type, wireless_technology, bluetooth_version,
  wireless_receiver_type, cable_type, cable_length,
  cable_detachable, cable_connector_type (USB-C/micro-USB/USB-A),
  usb_passthrough, multi_device_pairing

FEATURES (15 fields):
  rgb_lighting, rgb_type (per-key/underglow/side),
  rgb_software, onboard_profiles, macro_support,
  n_key_rollover, anti_ghosting, polling_rate,
  on_board_memory, game_mode, multimedia_wheel,
  volume_knob, display_screen, oled_screen_size,
  companion_software

BATTERY (6 fields):
  battery_capacity_mah, battery_life_rgb_on,
  battery_life_rgb_off, charging_time_hours,
  charge_while_use, low_battery_indicator

SOUND (6 fields):
  sound_dampening_included, foam_type,
  stabilizer_type (plate_mount/screw_in/snap_in),
  stabilizer_lubed, sound_profile_description,
  thock_vs_clack_rating

PERFORMANCE (8 fields):
  latency_wired, latency_wireless, latency_bluetooth,
  debounce_time_ms, firmware_updatable, via_qmk_compatible,
  custom_firmware_support, actuation_speed_rkst

COMMERCE + EDITORIAL + MEDIA: (same structure as mouse — ~18 fields)
```

---

## INTEGRATION TEST ARCHITECTURE

### Test Levels

```
LEVEL 1: UNIT TESTS (run on every commit)
  - FieldRulesEngine: 200+ tests per category
  - DeterministicParser: 100+ tests per category
  - Normalization functions: 150+ tests
  - Component DB lookups: 50+ tests per category
  - Identity Gate: 100+ tests
  Total: ~1000+ unit tests, <30 seconds

LEVEL 2: COMPONENT INTEGRATION TESTS (run daily)
  - Compiler → Loader → Engine roundtrip
  - Crawler → EvidencePack → Extractor pipeline
  - Extractor → Validator → ProductRecord pipeline
  - Override → Publish pipeline
  Total: ~100 integration tests, <5 minutes

LEVEL 3: END-TO-END PIPELINE TESTS (run weekly)
  - Full pipeline for 10 products × 3 categories
  - Against cached evidence (no live crawling)
  - Compare output to golden files
  - Accuracy threshold: must pass ≥93%
  Total: 30 E2E tests, <30 minutes

LEVEL 4: LIVE INTEGRATION TESTS (run monthly)
  - Full pipeline with REAL crawling
  - 3 products per category
  - Verify sources are accessible
  - Verify extraction still works against live pages
  - Detect source layout changes
  Total: 9 live tests, <1 hour

LEVEL 5: DRIFT CANARY TESTS (run daily)
  - Crawl a tiny set of high-risk sources (e.g., RTINGS, major manufacturers)
  - Compare `page_content_hash` / `snippet_hash` against last known-good snapshots
  - If drift detected, run extractor on cached evidence to see which fields break
  - Auto-open a GitHub issue / alert when a source layout change likely impacts accuracy
  Total: 5–10 canaries, <10 minutes
```

### Golden File Structure (Multi-Category)

```
fixtures/golden/
├── mouse/
│   ├── manifest.json
│   ├── mouse-razer-viper-v3-pro/
│   ├── mouse-logitech-g-pro-x-superlight-2/
│   ├── mouse-pulsar-x2-mini/
│   └── ... (50 products)
│
├── monitor/
│   ├── manifest.json
│   ├── monitor-lg-27gp850-b/
│   ├── monitor-samsung-odyssey-g7-s28bg702/
│   ├── monitor-dell-aw3225qf/
│   └── ... (30 products)
│
└── keyboard/
    ├── manifest.json
    ├── keyboard-wooting-60he/
    ├── keyboard-keychron-q1-pro/
    ├── keyboard-razer-huntsman-v3-pro/
    └── ... (30 products)
```

### CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/spec-factory-ci.yml
name: Spec Factory CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 3 * * 0'  # Weekly E2E tests

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm test -- --coverage
      
  compile-all-categories:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - run: node src/cli/spec.js compile-rules --all
      - run: node src/cli/spec.js validate-rules --all
      
  golden-file-benchmark:
    runs-on: ubuntu-latest
    needs: compile-all-categories
    steps:
      - run: node src/cli/spec.js benchmark-golden --category mouse --max-cases 50
      - run: node src/cli/spec.js benchmark-golden --category monitor --max-cases 30
      - run: node src/cli/spec.js benchmark-golden --category keyboard --max-cases 30
      - run: node src/cli/spec.js accuracy-report --all --format json > accuracy.json
      - uses: actions/upload-artifact@v4
        with:
          name: accuracy-report
          path: accuracy.json

  e2e-tests:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    needs: compile-all-categories
    steps:
      - run: node src/cli/spec.js e2e-test --all --cached-evidence
```

---

## PRODUCTION HARDENING CHECKLIST

### Error Recovery

```
FAILURE MODE                          │ RECOVERY ACTION
──────────────────────────────────────┼────────────────────────────────────
Page fetch timeout                    │ Retry 3× with exponential backoff
Page returns 403/429                  │ Mark source as throttled, skip to next
Playwright crash                      │ Restart browser, retry page
LLM API rate limited                  │ Queue with delay, respect retry-after
LLM returns malformed JSON            │ json-repair → retry with stricter prompt
LLM returns wrong schema              │ Instructor-JS auto-retry (max 3)
Disk full                             │ Alert + auto-cleanup old evidence
Process OOM                           │ pm2 auto-restart + memory limit
Evidence file corrupted               │ Delete cache, re-crawl from scratch
Evidence drift (snippet_hash mismatch)│ Quarantine product, re-crawl affected sources, block publish
Field rules compilation fail          │ Block publishing, alert admin
Network outage                        │ Pause queue, resume on connectivity
Power failure                         │ pm2 auto-restart, resume from last checkpoint
Redis connection lost (if used)       │ Fall back to JSON file queue
S3 upload failure                     │ Retry 3×, continue with local-only
Concurrent write conflict             │ File locking with proper-lockfile
```

### Memory Management

```javascript
// Long-running daemon memory management:

// 1. Browser pool: recycle Playwright contexts every 50 pages
const MAX_PAGES_PER_CONTEXT = 50;
let pageCount = 0;

async function getPage() {
  if (pageCount >= MAX_PAGES_PER_CONTEXT) {
    await currentContext.close();
    currentContext = await browser.newContext(contextOptions);
    pageCount = 0;
  }
  pageCount++;
  return currentContext.newPage();
}

// 2. Evidence cleanup: after publishing, compress and archive old evidence
// 3. LLM cache: LRU eviction when cache exceeds 1GB
// 4. Log rotation: Pino with daily rotation, 7-day retention
// 5. Heap snapshots: periodic V8 heap snapshot for leak detection
```

### Disk Space Management

```javascript
// Auto-cleanup policy:
const CLEANUP_RULES = {
  evidence_raw_html: { retain_days: 30, compress_after_days: 7 },
  evidence_cleaned_text: { retain_days: 90, compress_after_days: 30 },
  llm_cache: { max_size_gb: 2, eviction: 'lru' },
  published_versions: { retain_count: 5 },  // Keep last 5 versions per product
  logs: { retain_days: 30, rotate: 'daily' },
  golden_file_runs: { retain_count: 10 }    // Keep last 10 benchmark runs
};
```

### Observability & Traceability (24/7 Reliability)

Add first-class observability so you can diagnose *accuracy* issues (not just uptime):

- **OpenTelemetry traces** for each run (crawl → identity → extract → validate → publish)
- **Structured logs** with run_id/product_id/source_id on every line
- **Metrics**: per-field unknown rate, per-source block rate, per-model parse failure rate, evidence audit failure rate
- **Sampling**: keep full traces for any run that ends in `awaiting_review` or `quarantined`

This makes “accuracy regressions” debuggable instead of mysterious.

### Comprehensive Documentation

```
docs/
├── README.md                          # Project overview + quick start
├── ARCHITECTURE.md                    # System architecture diagram + data flow
├── FIELD-RULES-GUIDE.md              # How to author field rules for a new category
├── NEW-CATEGORY-GUIDE.md             # Step-by-step: adding a new product category
├── RUNBOOK.md                        # Operational runbook (troubleshooting, common issues)
├── API-REFERENCE.md                  # CLI commands + HTTP API endpoints
├── LLM-CONFIGURATION.md             # Model selection, prompt tuning, cost optimization
├── ACCURACY-METHODOLOGY.md          # How accuracy is measured and reported
├── DEPLOYMENT.md                    # Production deployment guide (pm2, systemd, Docker)
├── CONTRIBUTING.md                  # How to contribute (code style, PR process, testing)
└── CHANGELOG.md                     # Version history
```

---

## OPEN-SOURCE TOOLS & PLUGINS

### Required for This Phase

| Tool | Purpose | Install |
|------|---------|---------|
| **Vitest** | Test runner (fast, Vite-compatible) | `npm install vitest` |
| **@vitest/coverage-c8** | Code coverage | `npm install @vitest/coverage-c8` |
| **supertest** | HTTP API integration testing | `npm install supertest` |
| **nock** | HTTP mocking for crawl tests | `npm install nock` |
| **msw** | Mock Service Worker for API tests | `npm install msw` |
| **dockerode** | Docker integration (optional containerization) | `npm install dockerode` |
| **proper-lockfile** | File locking for concurrent writes | `npm install proper-lockfile` |
| **rotating-file-stream** | Log rotation | `npm install rotating-file-stream` |
| **compression** | Gzip for old evidence files | `npm install compression` |

### Recommended for Production

| Tool | Purpose | Install |
|------|---------|---------|
| **pm2** | Production process manager | `npm install -g pm2` |
| **clinic.js** | Node.js performance profiling | `npm install -g clinic` |
| **autocannon** | HTTP benchmarking for Review Grid API | `npm install -g autocannon` |
| **Docker** | Containerization for deployment | System install |
| **Prometheus + Grafana** | Metrics dashboard (optional) | Docker compose |

---

## FINAL ACCEPTANCE CRITERIA — THE ENTIRE SYSTEM

### Per-Category Criteria (must pass for mouse, monitor, AND keyboard)

1. ☐ field_rules.json compiled with ALL fields and complete metadata
2. ☐ Component DBs populated with ≥20 entries each
3. ☐ Known values with alias maps for all closed enums
4. ☐ Parse templates for all required + critical fields
5. ☐ Cross-validation rules (≥10 per category)
6. ☐ Golden files (≥30 products per category)
7. ☐ Source registry with ≥5 sources per category across ≥3 tiers
8. ☐ Pipeline processes 10 products end-to-end without errors
9. ☐ Golden-file accuracy ≥93% on expected fields
10. ☐ Golden-file accuracy ≥99% on required fields

### System-Level Criteria

11. ☐ 24/7 daemon runs for 48 hours without crashes
12. ☐ Daemon processes ≥15 products in a 24-hour period
13. ☐ Average cost per product ≤$0.15
14. ☐ Average processing time per product ≤15 minutes
15. ☐ Review Grid displays products from ALL categories correctly
16. ☐ Override system works identically across categories
17. ☐ Publishing pipeline produces all output formats for all categories
18. ☐ Accuracy monitoring detects when golden-file accuracy drops
19. ☐ CI/CD pipeline runs all tests in <30 minutes
20. ☐ New category initialization (`init-category`) produces working starter artifacts

### Documentation Criteria

21. ☐ README covers installation, configuration, and first run
22. ☐ New Category Guide enables a developer to add "headset" category in <1 day
23. ☐ Runbook covers all failure modes with recovery steps
24. ☐ Architecture doc has accurate system diagram
25. ☐ All CLI commands documented with examples

---

## CONGRATULATIONS

If all acceptance criteria pass across all 10 phases, you have built:

✅ A **category-agnostic** spec collection system
✅ That processes **15–20 products per day** autonomously
✅ With **~99% accuracy** on expected fields (93%+ automated + human review)
✅ With **full evidence provenance** for every value
✅ With **continuous accuracy monitoring** and regression detection
✅ That works for **any product category** (mouse, monitor, keyboard, GPU, CPU, ...)
✅ With a **fast human review interface** for the last-mile accuracy
✅ Using **two LLMs strategically** (Gemini Flash for speed, DeepSeek for reasoning)
✅ At **<$0.15 per product** in LLM costs
✅ Running **24/7** with self-healing and alerting

**The Spec Factory is operational. 🏭**
