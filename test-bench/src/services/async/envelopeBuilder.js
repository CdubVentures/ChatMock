function toNumberOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function truncateText(value, max = 240) {
  if (typeof value !== "string") {
    return "";
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

function detectConfidence(parsedJson, assistantText) {
  if (parsedJson && typeof parsedJson === "object") {
    if (Number.isFinite(Number(parsedJson.confidence))) {
      return Number(parsedJson.confidence);
    }
    if (parsedJson.meta && Number.isFinite(Number(parsedJson.meta.confidence))) {
      return Number(parsedJson.meta.confidence);
    }
  }
  if (typeof assistantText === "string" && assistantText.trim()) {
    return 0.7;
  }
  return null;
}

function normalizeEvidenceEntry(entry, defaults) {
  const out = entry && typeof entry === "object" ? entry : {};
  return {
    snippet_id: out.snippet_id || out.snippetId || null,
    quote: typeof out.quote === "string" && out.quote ? out.quote : truncateText(defaults.assistantText),
    dom_anchor: out.dom_anchor || out.domAnchor || defaults.domAnchor || null,
    screenshot_region: out.screenshot_region || out.screenshotRegion || defaults.screenshotRegion || null,
    model_path: out.model_path || out.modelPath || defaults.model || null,
    reasoning_note: out.reasoning_note || out.reasoningNote || defaults.reasoningNote || defaults.fallbackReason || ""
  };
}

function buildEvidenceList({ parsedJson, assistantText, model, requestMeta }) {
  const defaults = {
    assistantText: assistantText || "",
    model,
    domAnchor: requestMeta && requestMeta.domAnchor ? requestMeta.domAnchor : null,
    screenshotRegion: requestMeta && requestMeta.screenshotRegion ? requestMeta.screenshotRegion : null,
    fallbackReason:
      requestMeta && requestMeta.aggressive && requestMeta.aggressive.fallbackReason
        ? requestMeta.aggressive.fallbackReason
        : "",
    reasoningNote:
      requestMeta && requestMeta.reasoningNote
        ? requestMeta.reasoningNote
        : ""
  };
  const candidateEvidence =
    parsedJson && typeof parsedJson === "object" && Array.isArray(parsedJson.evidence)
      ? parsedJson.evidence
      : [];
  if (candidateEvidence.length > 0) {
    return candidateEvidence.map((entry) => normalizeEvidenceEntry(entry, defaults));
  }
  return [normalizeEvidenceEntry({}, defaults)];
}

function buildStructuredEnvelope({
  jobId,
  status,
  requestMeta,
  rawResponse,
  formatted,
  error,
  timings,
  attempts
}) {
  const aggressiveEnabled = Boolean(requestMeta && requestMeta.aggressive && requestMeta.aggressive.enabled);
  const confidenceBefore = toNumberOrNull(requestMeta && requestMeta.aggressive && requestMeta.aggressive.confidenceBefore);
  const confidenceAfter = detectConfidence(formatted && formatted.parsedJson, formatted && formatted.assistantText);
  const confidenceDelta =
    confidenceBefore !== null && confidenceAfter !== null
      ? Number((confidenceAfter - confidenceBefore).toFixed(6))
      : null;

  const evidence = buildEvidenceList({
    parsedJson: formatted && formatted.parsedJson ? formatted.parsedJson : null,
    assistantText: formatted && formatted.assistantText ? formatted.assistantText : "",
    model: requestMeta && requestMeta.model ? requestMeta.model : null,
    requestMeta: requestMeta || {}
  });

  const envelope = {
    job_id: jobId,
    status,
    request: {
      model: requestMeta && requestMeta.model ? requestMeta.model : null,
      priority: requestMeta && requestMeta.priority ? requestMeta.priority : "batch",
      aggressive: {
        enabled: aggressiveEnabled,
        fallback_reason:
          requestMeta && requestMeta.aggressive && requestMeta.aggressive.fallbackReason
            ? requestMeta.aggressive.fallbackReason
            : null
      }
    },
    result: {
      assistant_text: formatted && formatted.assistantText ? formatted.assistantText : "",
      parsed_json: formatted && formatted.parsedJson ? formatted.parsedJson : null,
      render_mode: formatted && formatted.mode ? formatted.mode : null,
      rendered_html: formatted && formatted.renderedHtml ? formatted.renderedHtml : "",
      raw_response: rawResponse || null,
      evidence,
      diagnostics: {
        attempts: Number.isFinite(Number(attempts)) ? Number(attempts) : 1,
        model_path: requestMeta && requestMeta.model ? requestMeta.model : null,
        latency: {
          queue_wait_ms: timings && Number.isFinite(Number(timings.queueWaitMs)) ? Number(timings.queueWaitMs) : null,
          model_ms: timings && Number.isFinite(Number(timings.modelTimeMs)) ? Number(timings.modelTimeMs) : null,
          total_ms: timings && Number.isFinite(Number(timings.totalMs)) ? Number(timings.totalMs) : null
        },
        aggressive: {
          enabled: aggressiveEnabled,
          fallback_reason:
            requestMeta && requestMeta.aggressive && requestMeta.aggressive.fallbackReason
              ? requestMeta.aggressive.fallbackReason
              : null,
          confidence_before: confidenceBefore,
          confidence_after: confidenceAfter,
          confidence_delta: confidenceDelta
        }
      }
    },
    error: error || null,
    timings: {
      queued_at: timings && timings.queuedAt ? timings.queuedAt : null,
      started_at: timings && timings.startedAt ? timings.startedAt : null,
      completed_at: timings && timings.completedAt ? timings.completedAt : null
    }
  };

  return envelope;
}

function buildReviewPayload(envelope) {
  const diagnostics = envelope && envelope.result && envelope.result.diagnostics ? envelope.result.diagnostics : {};
  const aggressive = diagnostics.aggressive || {};
  const evidence = envelope && envelope.result && Array.isArray(envelope.result.evidence) ? envelope.result.evidence : [];
  return {
    job_id: envelope && envelope.job_id ? envelope.job_id : null,
    status: envelope && envelope.status ? envelope.status : "unknown",
    before: {
      confidence: aggressive.confidence_before ?? null
    },
    after: {
      confidence: aggressive.confidence_after ?? null,
      model_path: diagnostics.model_path || null
    },
    evidence_links: evidence.map((entry) => ({
      snippet_id: entry.snippet_id || null,
      quote: entry.quote || "",
      dom_anchor: entry.dom_anchor || null,
      screenshot_region: entry.screenshot_region || null
    })),
    rationale: aggressive.fallback_reason || "No fallback reason provided.",
    parsed_json: envelope && envelope.result ? envelope.result.parsed_json : null,
    assistant_text: envelope && envelope.result ? envelope.result.assistant_text : ""
  };
}

module.exports = {
  buildEvidenceList,
  buildStructuredEnvelope,
  buildReviewPayload
};
