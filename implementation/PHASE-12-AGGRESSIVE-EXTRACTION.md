# PHASE 12 OF 12 — AGGRESSIVE MODE EXTRACTION (VISION & DOM)

## ROLE & CONTEXT

You are a senior ML-Pipeline engineer. Phase 11 gave you the "Cortex" machine. Phase 12 is about **using it**. This phase updates your extraction logic (Phase 5) to handle the hardest 5% of data: complex tables, visual charts, and layout-dependent specs that text-only models miss.

We call this **"Aggressive Mode."** Instead of sending clean text, we send the "Raw Reality" (DOM structure + Screenshots) to the Reasoning Model. This phase integrates the Cortex Sidecar into the main `SpecPipeline`.

**Dependencies:** Phase 5 (Extraction), Phase 4 (Crawling), and Phase 11 (Cortex Infra) must be complete.

---

## MISSION (NON-NEGOTIABLE)

Upgrade the extraction pipeline to achieve **99.9% accuracy** on "Critical" fields by:
1.  **Visual Perception:** Using screenshots to verify physical specs (ports, dimensions).
2.  **Structural Reasoning:** Using Raw DOM to understand complex table layouts.
3.  **Hybrid Workflow:** Using fast models (Flash) for easy fields, and "Aggressive Mode" (Reasoning) only for missing/low-confidence fields.

---

## WHAT THIS PHASE DELIVERS

### Deliverable 12A: The "Aggressive" Context Builder
A module in Phase 4 (Crawling) that prepares special evidence:
- **`capture_smart_screenshot()`:** Takes a full-page scroll screenshot and slices it into 3 vertical segments (to preserve resolution for the LLM).
- **`minify_dom()`:** A smart HTML stripper that removes `<script>`/`<style>` but PRESERVES `<table>`, `<div>`, `class`, and `id` structure.

### Deliverable 12B: The Hybrid Extraction Logic
Update `src/extraction/extractor.js` to support a fallback path:
1.  **Attempt 1:** Standard Text Extraction (Fast/Cheap).
2.  **Check:** If `Critical` fields are `null` or `confidence < 0.8`...
3.  **Attempt 2 (Aggressive):** Send DOM + Screenshot to `CortexClient` (ChatMock).
4.  **Merge:** Combine results, prioritizing Aggressive Mode for physical specs.

### Deliverable 12C: Visual Verification Prompts
New prompt templates specifically for the Reasoning Model:
- *"Look at the attached image of the spec table. Confirm if the 'Battery Life' value applies to the 'Pro' model or the standard model based on column headers."*

---

## ACCEPTANCE CRITERIA

1. ☐ `minify_dom` function reduces HTML size by 90% while keeping table structures intact.
2. ☐ Orchestrator correctly routes "Hard" products to the Cortex queue.
3. ☐ Aggressive Mode successfully extracts data from a "Image-Only" spec sheet (Vision test).
4. ☐ Hybrid Logic correctly falls back: Fast Fail → Aggressive Success.
5. ☐ End-to-End Latency is acceptable: "Aggressive" products take ~3-5 mins, Standard products take <30s.
6. ☐ The "Review Grid" (Phase 8) displays the *Screenshot Evidence* used for Aggressive extraction.
7. ☐ Accuracy Metric: "Complex Table" extraction accuracy improves from <70% to >95%.
8. ☐ Cost Management: The system does NOT use Aggressive Mode for easy products (conserving the Cortex queue capacity).
9. ☐ Reasoning Trace: The JSON output includes a `reasoning_log` field explaining *why* the model chose that value (e.g., "Found checkmark in column 2").
10. ☐ Full regression test of all previous phases passes.