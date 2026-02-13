const express = require("express");
const multer = require("multer");
const { buildExtractionMessages } = require("../services/promptBuilder");
const { formatAssistantOutput } = require("../services/responseFormatter");
const { minifyDOM } = require("../services/domMinifier");
const { TimeoutError, UpstreamError } = require("../services/chatmockClient");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const FALLBACK_MODELS = [
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-5",
  "gpt-5-high",
  "gpt-5-codex",
  "o1"
];

function truncateText(value, max = 500) {
  if (typeof value !== "string") {
    return value;
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}... [truncated ${value.length - max} chars]`;
}

function sanitizeForDisplay(value, depth = 0, maxDepth = 6) {
  if (depth > maxDepth) {
    return "[truncated depth]";
  }

  if (typeof value === "string") {
    return truncateText(value, 500);
  }

  if (Array.isArray(value)) {
    const entries = value.slice(0, 40).map((entry) => sanitizeForDisplay(entry, depth + 1, maxDepth));
    if (value.length > 40) {
      entries.push(`[truncated ${value.length - 40} items]`);
    }
    return entries;
  }

  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value);
    keys.slice(0, 60).forEach((key) => {
      out[key] = sanitizeForDisplay(value[key], depth + 1, maxDepth);
    });
    if (keys.length > 60) {
      out.__truncated_keys = keys.length - 60;
    }
    return out;
  }

  return value;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function parseTimeoutMs(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed === 0) {
    return 0;
  }
  if (parsed < 0) {
    return fallback;
  }
  return parsed;
}

function buildProviderConfig(appConfig) {
  return {
    provider: "chatmock",
    baseUrl: "http://localhost:8000/v1",
    model: "gpt-5-high",
    envTemplate: [
      "LLM_PROVIDER=chatmock",
      "LLM_BASE_URL=http://localhost:8000/v1",
      "LLM_MODEL=gpt-5-high"
    ].join("\n"),
    snippets: {
      python: [
        "from openai import OpenAI",
        "",
        "client = OpenAI(base_url='http://localhost:8000/v1', api_key='key')",
        "resp = client.chat.completions.create(",
        "  model='gpt-5-high',",
        "  messages=[{'role': 'user', 'content': 'Extract entities from this text'}]",
        ")",
        "print(resp.choices[0].message.content)"
      ].join("\n"),
      node: [
        "import OpenAI from 'openai';",
        "",
        "const client = new OpenAI({ baseURL: 'http://localhost:8000/v1', apiKey: 'key' });",
        "const resp = await client.chat.completions.create({",
        "  model: 'gpt-5-high',",
        "  messages: [{ role: 'user', content: 'Extract entities from this text' }]",
        "});",
        "console.log(resp.choices[0].message.content);"
      ].join("\n")
    },
    targetProxyUrl: `${appConfig.chatmockBaseUrl}/v1/chat/completions`
  };
}

router.get("/models", async (req, res) => {
  const client = req.app.locals.chatmockClient;

  try {
    const upstream = await client.listModels();
    const liveModels = Array.isArray(upstream && upstream.data)
      ? upstream.data.map((entry) => entry && entry.id).filter(Boolean)
      : [];
    const merged = Array.from(new Set([...FALLBACK_MODELS, ...liveModels]));
    return res.json({ models: merged, source: "chatmock" });
  } catch (_error) {
    return res.json({ models: FALLBACK_MODELS, source: "fallback" });
  }
});

router.get("/status", async (req, res) => {
  const client = req.app.locals.chatmockClient;
  const config = req.app.locals.config;

  try {
    await client.health();
    return res.json({
      connected: true,
      statusText: "Connected to Proxy",
      providerConfig: buildProviderConfig(config)
    });
  } catch (error) {
    return res.status(200).json({
      connected: false,
      statusText: "Proxy unreachable or login required",
      error: error && error.message ? error.message : "Unknown status error",
      providerConfig: buildProviderConfig(config)
    });
  }
});

router.get("/traffic", async (req, res) => {
  const client = req.app.locals.chatmockClient;
  const limit = Number.parseInt(req.query.limit, 10);
  const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 400) : 100;

  try {
    const upstream = await client.traffic(effectiveLimit);
    return res.json({
      ok: true,
      count: upstream && Number.isFinite(upstream.count) ? upstream.count : 0,
      data: upstream && Array.isArray(upstream.data) ? upstream.data : []
    });
  } catch (error) {
    if (error instanceof UpstreamError) {
      return res.status(error.statusCode || 502).json({
        ok: false,
        error: error.message,
        code: error.code || "UPSTREAM_ERROR",
        details: error.details || null
      });
    }
    return res.status(500).json({
      ok: false,
      error: "Unable to fetch proxy traffic.",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
});

router.delete("/traffic", async (req, res) => {
  const client = req.app.locals.chatmockClient;
  try {
    await client.clearTraffic();
    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof UpstreamError) {
      return res.status(error.statusCode || 502).json({
        ok: false,
        error: error.message,
        code: error.code || "UPSTREAM_ERROR",
        details: error.details || null
      });
    }
    return res.status(500).json({
      ok: false,
      error: "Unable to clear proxy traffic.",
      details: error && error.message ? error.message : "Unknown error"
    });
  }
});

async function handleExtraction(req, res) {
  const client = req.app.locals.chatmockClient;
  const config = req.app.locals.config;
  const body = req.body || {};
  const selectedModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "gpt-4o";
  const inputText = typeof body.inputText === "string" ? body.inputText : "";
  const aggressiveMode = parseBoolean(body.aggressiveMode, false);
  const timeoutMs = parseTimeoutMs(body.timeoutMs, req.app.locals.config.chatmockTimeoutMs);

  if (!inputText.trim()) {
    return res.status(400).json({ error: "inputText is required." });
  }

  const normalizedInput = aggressiveMode ? minifyDOM(inputText) : inputText;
  const imageDataUrl =
    req.file && req.file.buffer
      ? `data:${req.file.mimetype || "application/octet-stream"};base64,${req.file.buffer.toString("base64")}`
      : "";

  const payload = {
    model: selectedModel,
    messages: buildExtractionMessages(normalizedInput, { imageDataUrl }),
    temperature: 0,
    stream: false
  };
  const forwardedRequest = {
    endpointInternal: `${config.chatmockBaseUrl}/v1/chat/completions`,
    endpointExternal: "http://localhost:8000/v1/chat/completions",
    timeoutMs,
    payload: sanitizeForDisplay(payload)
  };
  const startedAt = Date.now();

  try {
    const upstream = await client.chatCompletions(payload, timeoutMs);
    const formatted = formatAssistantOutput(upstream);
    const durationMs = Date.now() - startedAt;

    return res.json({
      ok: true,
      model: selectedModel,
      aggressiveMode,
      hasImage: Boolean(imageDataUrl),
      forwardedRequest,
      raw: upstream,
      assistantText: formatted.assistantText,
      parsedJson: formatted.parsedJson,
      renderMode: formatted.mode,
      renderedHtml: formatted.renderedHtml,
      diagnostics: {
        inputLength: inputText.length,
        normalizedInputLength: normalizedInput.length,
        timeoutMs,
        durationMs,
        upstreamStatus: 200
      }
    });
  } catch (error) {
    if (error instanceof TimeoutError) {
      return res.status(504).json({
        error: "Request timed out while waiting for ChatMock. Reasoning models can take longer; try again with a higher timeout.",
        forwardedRequest
      });
    }

    if (error instanceof UpstreamError) {
      return res.status(error.statusCode || 502).json({
        error: error.message,
        code: error.code || "UPSTREAM_ERROR",
        details: error.details || null,
        forwardedRequest
      });
    }

    return res.status(500).json({
      error: "Unexpected server error.",
      details: error && error.message ? error.message : "Unknown error",
      forwardedRequest
    });
  }
}

router.post("/queue-test", async (req, res) => {
  const client = req.app.locals.chatmockClient;
  const config = req.app.locals.config;
  const body = req.body || {};
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "gpt-5-high";
  const requestCountRaw = Number.parseInt(body.requestCount, 10);
  const requestCount = Number.isFinite(requestCountRaw) ? Math.min(10, Math.max(2, requestCountRaw)) : 5;
  const timeoutMs = parseTimeoutMs(body.timeoutMs, config.chatmockTimeoutMs);
  const inputText = typeof body.inputText === "string" && body.inputText.trim()
    ? body.inputText.trim()
    : "Queue validation test";

  const startedAt = Date.now();
  const results = await Promise.all(
    Array.from({ length: requestCount }, async (_value, index) => {
      const id = index + 1;
      const perRequestStart = Date.now();
      const payload = {
        model,
        stream: false,
        temperature: 0,
        messages: buildExtractionMessages(`${inputText}\n\nQueue request #${id}. Reply with a short acknowledgement.`)
      };

      try {
        const upstream = await client.chatCompletions(payload, timeoutMs);
        const completionMs = Date.now();
        const content =
          upstream &&
          Array.isArray(upstream.choices) &&
          upstream.choices[0] &&
          upstream.choices[0].message &&
          typeof upstream.choices[0].message.content === "string"
            ? upstream.choices[0].message.content
            : "";

        return {
          id,
          ok: true,
          statusCode: 200,
          startedAt: new Date(perRequestStart).toISOString(),
          completedAt: new Date(completionMs).toISOString(),
          elapsedMs: completionMs - perRequestStart,
          assistantPreview: truncateText(content, 220),
          requestPayload: sanitizeForDisplay(payload),
          responsePayload: sanitizeForDisplay(upstream),
          raw: sanitizeForDisplay(upstream)
        };
      } catch (error) {
        const completionMs = Date.now();
        if (error instanceof TimeoutError) {
          return {
            id,
            ok: false,
            statusCode: 504,
            startedAt: new Date(perRequestStart).toISOString(),
            completedAt: new Date(completionMs).toISOString(),
            elapsedMs: completionMs - perRequestStart,
            requestPayload: sanitizeForDisplay(payload),
            error: "Request timed out."
          };
        }
        if (error instanceof UpstreamError) {
          return {
            id,
            ok: false,
            statusCode: error.statusCode || 502,
            startedAt: new Date(perRequestStart).toISOString(),
            completedAt: new Date(completionMs).toISOString(),
            elapsedMs: completionMs - perRequestStart,
            requestPayload: sanitizeForDisplay(payload),
            error: error.message,
            details: sanitizeForDisplay(error.details || null),
            responsePayload: sanitizeForDisplay(error.details || null)
          };
        }
        return {
          id,
          ok: false,
          statusCode: 500,
          startedAt: new Date(perRequestStart).toISOString(),
          completedAt: new Date(completionMs).toISOString(),
          elapsedMs: completionMs - perRequestStart,
          requestPayload: sanitizeForDisplay(payload),
          error: error && error.message ? error.message : "Unknown queue-test error."
        };
      }
    })
  );

  const byCompletion = [...results].sort((a, b) => {
    const left = Date.parse(a.completedAt);
    const right = Date.parse(b.completedAt);
    return left - right;
  });
  const expectedOrder = Array.from({ length: requestCount }, (_value, i) => i + 1);
  const completionOrder = byCompletion.map((entry) => entry.id);
  const fifo = expectedOrder.every((id, index) => completionOrder[index] === id);
  const completed = results.filter((entry) => entry.ok).length;
  const failed = results.length - completed;
  const totalElapsedMs = Date.now() - startedAt;

  return res.json({
    ok: true,
    model,
    requestCount,
    summary: {
      fifo,
      completed,
      failed,
      requestCount,
      totalElapsedMs,
      expectedOrder,
      completionOrder
    },
    resultsByCompletion: byCompletion,
    resultsById: [...results].sort((a, b) => a.id - b.id)
  });
});

router.post("/extract", upload.single("imageFile"), handleExtraction);
router.post("/test-extract", upload.single("imageFile"), handleExtraction);

module.exports = router;
