const {
  buildEvidenceList,
  buildStructuredEnvelope,
  buildReviewPayload
} = require("../src/services/async/envelopeBuilder");

describe("async envelope builder", () => {
  test("builds evidence list from parsed json evidence array", () => {
    const evidence = buildEvidenceList({
      parsedJson: {
        evidence: [
          {
            snippet_id: "snip-1",
            quote: "Battery life up to 120h",
            dom_anchor: "#specs .battery",
            screenshot_region: "bottom-right",
            model_path: "gpt-5-high",
            reasoning_note: "Matched row label."
          }
        ]
      },
      assistantText: "ok",
      model: "gpt-5-high",
      requestMeta: {}
    });

    expect(evidence).toHaveLength(1);
    expect(evidence[0].snippet_id).toBe("snip-1");
    expect(evidence[0].quote).toMatch(/120h/i);
    expect(evidence[0].dom_anchor).toBe("#specs .battery");
  });

  test("falls back to placeholder evidence when none supplied", () => {
    const evidence = buildEvidenceList({
      parsedJson: null,
      assistantText: "This is the extracted response text.",
      model: "gpt-5-high",
      requestMeta: { domAnchor: "#fallback", screenshotRegion: "full" }
    });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].snippet_id).toBeNull();
    expect(evidence[0].quote).toMatch(/extracted response/i);
    expect(evidence[0].dom_anchor).toBe("#fallback");
    expect(evidence[0].screenshot_region).toBe("full");
  });

  test("builds structured envelope with confidence delta and diagnostics", () => {
    const envelope = buildStructuredEnvelope({
      jobId: "job-1",
      status: "completed",
      requestMeta: {
        model: "gpt-5-high",
        aggressive: {
          enabled: true,
          fallbackReason: "critical_field_missing",
          confidenceBefore: 0.42
        }
      },
      rawResponse: { id: "chatcmpl-1", choices: [{ message: { content: "{\"confidence\":0.9}" } }] },
      formatted: {
        assistantText: "{\"confidence\":0.9}",
        parsedJson: { confidence: 0.9 },
        renderedHtml: "<p>ok</p>",
        mode: "table"
      },
      error: null,
      timings: {
        queuedAt: "2026-02-13T00:00:00.000Z",
        startedAt: "2026-02-13T00:00:01.000Z",
        completedAt: "2026-02-13T00:00:05.000Z",
        queueWaitMs: 1000,
        modelTimeMs: 4000,
        totalMs: 5000
      },
      attempts: 1
    });

    expect(envelope.job_id).toBe("job-1");
    expect(envelope.status).toBe("completed");
    expect(envelope.result.diagnostics.latency.model_ms).toBe(4000);
    expect(envelope.result.diagnostics.aggressive.confidence_before).toBe(0.42);
    expect(envelope.result.diagnostics.aggressive.confidence_after).toBe(0.9);
    expect(envelope.result.diagnostics.aggressive.confidence_delta).toBeCloseTo(0.48);
    expect(envelope.result.evidence.length).toBeGreaterThan(0);
  });

  test("buildReviewPayload returns Phase-8 friendly shape", () => {
    const envelope = {
      job_id: "job-99",
      status: "completed",
      result: {
        diagnostics: {
          aggressive: {
            enabled: true,
            fallback_reason: "low_confidence",
            confidence_before: 0.5,
            confidence_after: 0.83,
            confidence_delta: 0.33
          },
          model_path: "gpt-5-high"
        },
        evidence: [{ snippet_id: "s1", quote: "Weight: 56g" }],
        assistant_text: "Weight: 56g",
        parsed_json: { weight_g: 56 }
      }
    };
    const payload = buildReviewPayload(envelope);
    expect(payload.job_id).toBe("job-99");
    expect(payload.before.confidence).toBe(0.5);
    expect(payload.after.confidence).toBe(0.83);
    expect(payload.evidence_links).toHaveLength(1);
    expect(payload.rationale).toMatch(/low_confidence/i);
  });
});
