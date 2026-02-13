const DEFAULT_MODELS = [
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-5",
  "gpt-5-high",
  "gpt-5-codex",
  "o1"
];

const modelSelect = document.getElementById("modelSelect");
const inputText = document.getElementById("inputText");
const runButton = document.getElementById("runButton");
const requestOutput = document.getElementById("requestOutput");
const rawOutput = document.getElementById("rawOutput");
const renderedOutput = document.getElementById("renderedOutput");
const statusMessage = document.getElementById("statusMessage");
const aggressiveToggle = document.getElementById("aggressiveToggle");
const imageRow = document.getElementById("imageRow");
const imageFile = document.getElementById("imageFile");
const proxyDot = document.getElementById("proxyDot");
const proxyStatusText = document.getElementById("proxyStatusText");
const proxyTarget = document.getElementById("proxyTarget");
const envTemplate = document.getElementById("envTemplate");
const pythonSnippet = document.getElementById("pythonSnippet");
const nodeSnippet = document.getElementById("nodeSnippet");

const trafficOutput = document.getElementById("trafficOutput");
const trafficStatus = document.getElementById("trafficStatus");
const toggleHealthTrafficButton = document.getElementById("toggleHealthTrafficButton");
const trafficViewTableButton = document.getElementById("trafficViewTableButton");
const trafficViewJsonButton = document.getElementById("trafficViewJsonButton");
const refreshTrafficButton = document.getElementById("refreshTrafficButton");
const clearTrafficButton = document.getElementById("clearTrafficButton");
const trafficTableWrap = document.getElementById("trafficTableWrap");
const trafficTableBody = document.getElementById("trafficTableBody");

const queueCount = document.getElementById("queueCount");
const queueSortField = document.getElementById("queueSortField");
const queueSortDirButton = document.getElementById("queueSortDirButton");
const runQueueButton = document.getElementById("runQueueButton");
const queueStatus = document.getElementById("queueStatus");
const queueSummaryChips = document.getElementById("queueSummaryChips");
const queueViewTableButton = document.getElementById("queueViewTableButton");
const queueViewJsonButton = document.getElementById("queueViewJsonButton");
const queueTableWrap = document.getElementById("queueTableWrap");
const queueTableBody = document.getElementById("queueTableBody");
const queueOutput = document.getElementById("queueOutput");
const queueTableHeadCells = Array.from(document.querySelectorAll("#queueTable thead th[data-sort-field]"));

const inspectorModal = document.getElementById("inspectorModal");
const inspectorBackdrop = document.getElementById("inspectorBackdrop");
const inspectorCloseButton = document.getElementById("inspectorCloseButton");
const inspectorTitle = document.getElementById("inspectorTitle");
const inspectorRequest = document.getElementById("inspectorRequest");
const inspectorResponse = document.getElementById("inspectorResponse");

let thinkingTimer = null;
let trafficPollTimer = null;
let queueSortDirection = "asc";
let queueViewMode = "table";
let trafficViewMode = "table";
let latestQueuePayload = null;
let latestTrafficRows = [];
let latestTrafficTableRows = [];
let showHealthTraffic = false;
let queueRunInProgress = false;

function truncateText(value, max = 450) {
  if (typeof value !== "string") {
    return value;
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}... [truncated ${value.length - max} chars]`;
}

function truncateDeep(value, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) {
    return "[truncated depth]";
  }
  if (typeof value === "string") {
    return truncateText(value, 450);
  }
  if (Array.isArray(value)) {
    const capped = value.slice(0, 30).map((entry) => truncateDeep(entry, depth + 1, maxDepth));
    if (value.length > 30) {
      capped.push(`[truncated ${value.length - 30} items]`);
    }
    return capped;
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value);
    for (const key of keys.slice(0, 40)) {
      out[key] = truncateDeep(value[key], depth + 1, maxDepth);
    }
    if (keys.length > 40) {
      out.__truncated_keys = keys.length - 40;
    }
    return out;
  }
  return value;
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return JSON.stringify({ error: "Unable to serialize value." }, null, 2);
  }
}

function formatClockTime(iso) {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function updateStatus(message, mode = "idle") {
  statusMessage.textContent = message;
  statusMessage.classList.remove("busy", "error");
  if (mode === "busy") {
    statusMessage.classList.add("busy");
  }
  if (mode === "error") {
    statusMessage.classList.add("error");
  }
}

function updateQueueStatus(message, mode = "idle") {
  queueStatus.textContent = message;
  queueStatus.classList.remove("busy", "error");
  if (mode === "busy") {
    queueStatus.classList.add("busy");
  }
  if (mode === "error") {
    queueStatus.classList.add("error");
  }
}

function setProxyStatus(connected, text) {
  proxyStatusText.textContent = text;
  proxyDot.classList.remove("dot-online", "dot-offline");
  proxyDot.classList.add(connected ? "dot-online" : "dot-offline");
}

function populateModels(models) {
  const merged = [...new Set([...(models || []), ...DEFAULT_MODELS])];
  const sorted = merged.sort((a, b) => a.localeCompare(b));
  modelSelect.innerHTML = "";

  sorted.forEach((modelName) => {
    const option = document.createElement("option");
    option.value = modelName;
    option.textContent = modelName;
    if (modelName === "gpt-5-high") {
      option.selected = true;
    }
    modelSelect.appendChild(option);
  });
}

function applyProviderConfig(providerConfig) {
  if (!providerConfig) {
    return;
  }
  proxyTarget.textContent = providerConfig.targetProxyUrl || "http://localhost:8000/v1/chat/completions";
  envTemplate.textContent = providerConfig.envTemplate || "";
  pythonSnippet.textContent = providerConfig.snippets && providerConfig.snippets.python ? providerConfig.snippets.python : "";
  nodeSnippet.textContent = providerConfig.snippets && providerConfig.snippets.node ? providerConfig.snippets.node : "";
}

function handleAggressiveToggleChange() {
  const enabled = aggressiveToggle.checked;
  imageRow.classList.toggle("hidden", !enabled);
  if (!enabled) {
    imageFile.value = "";
  }
}

function simplifyTrafficRow(row) {
  return {
    ts: row.timestamp,
    method: row.method,
    path: row.path,
    status: row.response ? row.response.status_code : null,
    duration_ms: row.response ? row.response.duration_ms : null,
    streamed: row.response ? row.response.is_streamed : null,
    request_payload: truncateDeep(row.payload),
    response_payload: truncateDeep(row.response ? row.response.payload : null)
  };
}

function isHealthTrafficRow(row) {
  if (!row || typeof row !== "object") {
    return false;
  }
  return row.method === "GET" && row.path === "/health";
}

function extractQueueIdFromRequestPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return null;
  }
  const first = payload.messages[0];
  if (!first || typeof first !== "object") {
    return null;
  }
  const content = typeof first.content === "string" ? first.content : "";
  const match = content.match(/queue test request #(\d+)/i);
  if (!match) {
    return null;
  }
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) ? id : null;
}

function parseQueueResultsFromTrafficRows(rows) {
  const queueRows = (rows || []).filter((row) => {
    if (!row || row.path !== "/v1/chat/completions") {
      return false;
    }
    return Number.isFinite(extractQueueIdFromRequestPayload(row.payload));
  });

  if (!queueRows.length) {
    return null;
  }

  const normalized = queueRows
    .map((row) => {
      const id = extractQueueIdFromRequestPayload(row.payload);
      if (!Number.isFinite(id)) {
        return null;
      }
      const hasResponse = row.response && Number.isFinite(row.response.status_code);
      const statusCode = hasResponse ? row.response.status_code : null;
      const elapsedMsRaw = row.response && Number.isFinite(row.response.duration_ms) ? row.response.duration_ms : null;
      const elapsedMs = Number.isFinite(elapsedMsRaw) ? Math.round(elapsedMsRaw) : null;
      const startedAt = typeof row.timestamp === "string" ? row.timestamp : null;
      const completedAt = startedAt && Number.isFinite(elapsedMs)
        ? new Date(Date.parse(startedAt) + elapsedMs).toISOString()
        : startedAt;

      const responsePayload = row.response && row.response.payload ? row.response.payload : null;
      const assistantContent =
        responsePayload &&
        Array.isArray(responsePayload.choices) &&
        responsePayload.choices[0] &&
        responsePayload.choices[0].message &&
        typeof responsePayload.choices[0].message.content === "string"
          ? responsePayload.choices[0].message.content
          : "";

      const ok = hasResponse && statusCode >= 200 && statusCode < 300;
      const errorMessage =
        hasResponse && !ok && responsePayload && responsePayload.error && typeof responsePayload.error.message === "string"
          ? responsePayload.error.message
          : "";

      return {
        id,
        ok,
        pending: !hasResponse,
        statusCode,
        startedAt,
        completedAt,
        elapsedMs,
        assistantPreview: truncateText(assistantContent || errorMessage || "", 220),
        raw: truncateDeep(responsePayload, 0, 6),
        source: "traffic",
        requestPayload: truncateDeep(row.payload, 0, 6),
        responsePayload: truncateDeep(responsePayload, 0, 6)
      };
    })
    .filter(Boolean);

  if (!normalized.length) {
    return null;
  }

  const finishedRows = normalized.filter((row) => row && !row.pending);
  if (finishedRows.length === 0) {
    return null;
  }

  const uniqueById = new Map();
  normalized.forEach((row) => {
    const existing = uniqueById.get(row.id);
    if (!existing) {
      uniqueById.set(row.id, row);
      return;
    }
    const existingTs = Date.parse(existing.completedAt || existing.startedAt || "");
    const candidateTs = Date.parse(row.completedAt || row.startedAt || "");
    if (candidateTs > existingTs) {
      uniqueById.set(row.id, row);
    }
  });

  const resultsById = Array.from(uniqueById.values()).sort((a, b) => a.id - b.id);
  const resultsByCompletion = [...resultsById].sort((a, b) => {
    const left = Date.parse(a.completedAt || a.startedAt || "") || 0;
    const right = Date.parse(b.completedAt || b.startedAt || "") || 0;
    return left - right;
  });

  const maxId = Math.max(...resultsById.map((row) => row.id));
  const expectedOrder = Array.from({ length: maxId }, (_v, index) => index + 1);
  const completionOrder = resultsByCompletion.map((row) => row.id);
  const fifo = expectedOrder.slice(0, completionOrder.length).every((id, index) => completionOrder[index] === id);
  const completed = resultsById.filter((row) => row.ok).length;
  const failed = resultsById.filter((row) => !row.ok && !row.pending).length;
  const pending = resultsById.filter((row) => row.pending).length;
  const startEpoch = Math.min(...resultsById.map((row) => Date.parse(row.startedAt || "") || Date.now()));
  const endEpoch = Math.max(...resultsById.map((row) => Date.parse(row.completedAt || row.startedAt || "") || startEpoch));

  return {
    ok: true,
    source: "traffic",
    model: "mixed/external",
    requestCount: maxId,
    summary: {
      fifo,
      completed,
      failed,
      pending,
      requestCount: maxId,
      totalElapsedMs: Math.max(0, Math.round(endEpoch - startEpoch)),
      expectedOrder,
      completionOrder
    },
    resultsByCompletion,
    resultsById
  };
}

function normalizeQueueCount() {
  const parsed = Number.parseInt(queueCount.value, 10);
  if (!Number.isFinite(parsed)) {
    queueCount.value = "5";
    return 5;
  }
  const clamped = Math.min(10, Math.max(2, parsed));
  queueCount.value = String(clamped);
  return clamped;
}

function openInspector(title, requestObj, responseObj) {
  inspectorTitle.textContent = title || "Request Inspector";
  inspectorRequest.textContent = safeJsonStringify(requestObj || {});
  inspectorResponse.textContent = safeJsonStringify(responseObj || {});
  inspectorModal.classList.remove("hidden");
}

function closeInspector() {
  inspectorModal.classList.add("hidden");
}

function setQueueSortDirection(direction) {
  queueSortDirection = direction === "desc" ? "desc" : "asc";
  queueSortDirButton.textContent = queueSortDirection === "asc" ? "Asc" : "Desc";
}

function setQueueViewMode(mode) {
  queueViewMode = mode === "json" ? "json" : "table";
  const tableActive = queueViewMode === "table";
  queueTableWrap.classList.toggle("hidden", !tableActive);
  queueOutput.classList.toggle("hidden", tableActive);
  queueViewTableButton.classList.toggle("active", tableActive);
  queueViewJsonButton.classList.toggle("active", !tableActive);
}

function setTrafficViewMode(mode) {
  trafficViewMode = mode === "json" ? "json" : "table";
  const tableActive = trafficViewMode === "table";
  trafficTableWrap.classList.toggle("hidden", !tableActive);
  trafficOutput.classList.toggle("hidden", tableActive);
  trafficViewTableButton.classList.toggle("active", tableActive);
  trafficViewJsonButton.classList.toggle("active", !tableActive);
}

function renderQueueSummary(summary) {
  if (!summary) {
    queueSummaryChips.innerHTML = "";
    return;
  }
  const fifoClass = summary.fifo ? "chip-ok" : "chip-warn";
  const pendingCount = Number.isFinite(summary.pending) ? summary.pending : 0;
  queueSummaryChips.innerHTML = [
    `<span class="summary-chip ${fifoClass}">FIFO: ${summary.fifo ? "Yes" : "No"}</span>`,
    `<span class="summary-chip">Completed: ${summary.completed}/${summary.requestCount}</span>`,
    `<span class="summary-chip ${summary.failed > 0 ? "chip-warn" : "chip-ok"}">Failed: ${summary.failed}</span>`,
    `<span class="summary-chip ${pendingCount > 0 ? "chip-warn" : "chip-ok"}">Pending: ${pendingCount}</span>`,
    `<span class="summary-chip">Total: ${summary.totalElapsedMs}ms</span>`
  ].join("");
}

function queueSortValue(row, field) {
  if (!row || typeof row !== "object") {
    return null;
  }
  if (field === "startedAt" || field === "completedAt") {
    return Date.parse(row[field] || "") || 0;
  }
  if (field === "elapsedMs" || field === "statusCode" || field === "id") {
    const value = Number(row[field]);
    return Number.isFinite(value) ? value : 0;
  }
  return row[field];
}

function renderQueueSortIndicators() {
  const sortField = queueSortField.value || "completedAt";
  queueTableHeadCells.forEach((cell) => {
    const field = cell.dataset.sortField;
    if (field === sortField) {
      cell.classList.add("is-sorted");
      cell.dataset.sortDir = queueSortDirection;
    } else {
      cell.classList.remove("is-sorted");
      delete cell.dataset.sortDir;
    }
  });
}

function renderQueueTable(payload) {
  const rows = Array.isArray(payload && payload.resultsById) ? [...payload.resultsById] : [];
  if (rows.length === 0) {
    queueTableBody.innerHTML = "<tr><td colspan=\"6\" class=\"empty-row\">No queue results yet.</td></tr>";
    renderQueueSortIndicators();
    return;
  }

  const sortField = queueSortField.value || "completedAt";
  const sortFactor = queueSortDirection === "asc" ? 1 : -1;
  rows.sort((left, right) => {
    const l = queueSortValue(left, sortField);
    const r = queueSortValue(right, sortField);
    if (l === r) {
      return (left.id - right.id) * sortFactor;
    }
    if (l > r) {
      return 1 * sortFactor;
    }
    if (l < r) {
      return -1 * sortFactor;
    }
    return 0;
  });

  const bodyHtml = rows
    .map((row) => {
      const ok = Boolean(row.ok);
      const pending = Boolean(row.pending);
      const statusClass = pending ? "row-pending" : (ok ? "row-ok" : "row-fail");
      const preview = row.assistantPreview || row.error || "-";
      const statusLabel = pending
        ? "PENDING"
        : `${ok ? "OK" : "ERR"} ${row.statusCode || "-"}`;
      const statusChipClass = pending
        ? "status-pending"
        : (ok ? "status-ok" : "status-fail");
      return [
        `<tr class="${statusClass}" data-queue-id="${row.id}">`,
        `<td>${row.id}</td>`,
        `<td><span class="status-chip ${statusChipClass}">${statusLabel}</span></td>`,
        `<td>${Number.isFinite(row.elapsedMs) ? row.elapsedMs : (pending ? "pending" : "-")}</td>`,
        `<td>${formatClockTime(row.startedAt)}</td>`,
        `<td>${formatClockTime(row.completedAt)}</td>`,
        `<td class="preview-cell" title="${escapeHtml(preview)}">${escapeHtml(truncateText(preview, 130))}</td>`,
        "</tr>"
      ].join("");
    })
    .join("");

  queueTableBody.innerHTML = bodyHtml;
  renderQueueSortIndicators();
}

function renderTrafficTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    latestTrafficTableRows = [];
    trafficTableBody.innerHTML = "<tr><td colspan=\"6\" class=\"empty-row\">No traffic records.</td></tr>";
    return;
  }
  const ordered = [...rows].sort((a, b) => {
    const left = Date.parse(a.timestamp || "") || 0;
    const right = Date.parse(b.timestamp || "") || 0;
    return right - left;
  });
  latestTrafficTableRows = ordered;

  const html = ordered.map((row, index) => {
    const hasResponse = row.response && Number.isFinite(row.response.status_code);
    const statusCode = hasResponse ? row.response.status_code : "PENDING";
    const duration = row.response && Number.isFinite(row.response.duration_ms) ? Math.round(row.response.duration_ms) : "pending";
    const content =
      row.response &&
      row.response.payload &&
      Array.isArray(row.response.payload.choices) &&
      row.response.payload.choices[0] &&
      row.response.payload.choices[0].message &&
      typeof row.response.payload.choices[0].message.content === "string"
        ? row.response.payload.choices[0].message.content
        : "";
    const preview = content || (row.path === "/health" ? "Health check" : row.path);
    const rowClass = !hasResponse ? "row-pending" : (statusCode === 200 ? "row-ok" : "row-fail");
    return [
      `<tr class="${rowClass}" data-traffic-index="${index}">`,
      `<td>${formatClockTime(row.timestamp)}</td>`,
      `<td>${escapeHtml(row.method || "-")}</td>`,
      `<td>${escapeHtml(row.path || "-")}</td>`,
      `<td>${statusCode}</td>`,
      `<td>${duration}</td>`,
      `<td class="preview-cell" title="${escapeHtml(preview)}">${escapeHtml(truncateText(preview, 130))}</td>`,
      "</tr>"
    ].join("");
  }).join("");

  trafficTableBody.innerHTML = html;
}

function renderQueuePayload(payload) {
  latestQueuePayload = payload;
  queueOutput.textContent = safeJsonStringify(truncateDeep(payload, 0, 6));
  renderQueueSummary(payload && payload.summary ? payload.summary : null);
  renderQueueTable(payload || {});
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    const payload = await response.json();
    setProxyStatus(Boolean(payload.connected), payload.statusText || "Unknown");
    applyProviderConfig(payload.providerConfig);
  } catch (_error) {
    setProxyStatus(false, "Status unavailable");
  }
}

async function loadTraffic() {
  try {
    const response = await fetch("/api/traffic?limit=80");
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unable to fetch traffic.");
    }
    const allRows = Array.isArray(payload.data) ? payload.data : [];
    const filteredRows = showHealthTraffic ? allRows : allRows.filter((row) => !isHealthTrafficRow(row));
    latestTrafficRows = filteredRows;
    const simplified = filteredRows.map(simplifyTrafficRow);
    trafficOutput.textContent = safeJsonStringify(simplified);
    renderTrafficTable(filteredRows);
    if (showHealthTraffic) {
      trafficStatus.textContent = `Traffic records: ${filteredRows.length} (health included)`;
    } else {
      trafficStatus.textContent = `Traffic records: ${filteredRows.length} shown / ${allRows.length} total (health hidden)`;
    }
    trafficStatus.classList.remove("error");

    const queueFromTraffic = parseQueueResultsFromTrafficRows(allRows);
    if (queueFromTraffic && !queueRunInProgress) {
      renderQueuePayload(queueFromTraffic);
      if (!runQueueButton.disabled) {
        const summary = queueFromTraffic.summary || {};
        updateQueueStatus(
          `Observed queue run from traffic. Completed ${summary.completed}/${summary.requestCount}.`,
          summary.fifo ? "idle" : "error"
        );
      }
    }
  } catch (error) {
    trafficStatus.textContent = error.message || "Unable to fetch traffic.";
    trafficStatus.classList.add("error");
  }
}

async function clearTraffic() {
  clearTrafficButton.disabled = true;
  try {
    const response = await fetch("/api/traffic", { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unable to clear traffic.");
    }
    await loadTraffic();
  } catch (error) {
    trafficStatus.textContent = error.message || "Unable to clear traffic.";
    trafficStatus.classList.add("error");
  } finally {
    clearTrafficButton.disabled = false;
  }
}

function startTrafficPolling() {
  if (trafficPollTimer) {
    clearInterval(trafficPollTimer);
  }
  trafficPollTimer = setInterval(loadTraffic, 3000);
}

async function loadModels() {
  try {
    const response = await fetch("/api/models");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Unable to fetch model list.");
    }
    populateModels(payload.models || DEFAULT_MODELS);
    updateStatus(`Loaded models (${payload.source || "unknown"}).`);
  } catch (_error) {
    populateModels(DEFAULT_MODELS);
    updateStatus("Using fallback model list.", "error");
  }
}

function startThinkingTimer() {
  stopThinkingTimer();
  thinkingTimer = setTimeout(() => {
    updateStatus("Reasoning... Do not refresh.", "busy");
  }, 10000);
}

function stopThinkingTimer() {
  if (thinkingTimer) {
    clearTimeout(thinkingTimer);
    thinkingTimer = null;
  }
}

function renderForwardedRequest(forwardedRequest) {
  requestOutput.textContent = safeJsonStringify(forwardedRequest || {});
}

async function runExtraction() {
  const text = inputText.value.trim();
  if (!text) {
    updateStatus("Input text is required.", "error");
    return;
  }

  runButton.disabled = true;
  updateStatus("Submitting request...", "busy");
  startThinkingTimer();

  try {
    const formData = new FormData();
    formData.append("model", modelSelect.value);
    formData.append("inputText", text);
    formData.append("aggressiveMode", String(aggressiveToggle.checked));
    if (imageFile.files && imageFile.files[0]) {
      formData.append("imageFile", imageFile.files[0]);
    }

    const response = await fetch("/api/test-extract", {
      method: "POST",
      body: formData
    });

    const payload = await response.json();
    if (!response.ok) {
      renderForwardedRequest(payload.forwardedRequest);
      throw new Error(payload.error || "Extraction failed.");
    }

    renderForwardedRequest(payload.forwardedRequest);
    rawOutput.textContent = safeJsonStringify(truncateDeep(payload.raw, 0, 6));
    renderedOutput.innerHTML = payload.renderedHtml || "<p class=\"placeholder\">No renderable content returned.</p>";
    updateStatus(`Completed with model ${payload.model}.`);
    loadTraffic();
  } catch (error) {
    renderedOutput.innerHTML = "<p class=\"placeholder\">No result due to an error.</p>";
    updateStatus(error.message || "Request failed.", "error");
  } finally {
    stopThinkingTimer();
    runButton.disabled = false;
    loadStatus();
  }
}

async function runQueueTest() {
  const count = normalizeQueueCount();
  runQueueButton.disabled = true;
  queueRunInProgress = true;
  updateQueueStatus(`Running ${count} concurrent requests...`, "busy");

  try {
    const baseText = inputText.value.trim() || "Queue test prompt";
    const response = await fetch("/api/queue-test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requestCount: count,
        model: modelSelect.value,
        inputText: baseText
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Queue test failed.");
    }

    const summary = payload.summary || {};
    const statusLabel = summary.fifo ? "FIFO confirmed" : "Non-FIFO / inconclusive";
    updateQueueStatus(
      `${statusLabel}. Completed ${summary.completed}/${summary.requestCount} in ${summary.totalElapsedMs}ms.`,
      summary.fifo ? "idle" : "error"
    );
    renderQueuePayload(payload);
    loadTraffic();
  } catch (error) {
    updateQueueStatus(error.message || "Queue test failed.", "error");
  } finally {
    queueRunInProgress = false;
    runQueueButton.disabled = false;
    loadStatus();
  }
}

runButton.addEventListener("click", runExtraction);
aggressiveToggle.addEventListener("change", handleAggressiveToggleChange);
refreshTrafficButton.addEventListener("click", loadTraffic);
clearTrafficButton.addEventListener("click", clearTraffic);
runQueueButton.addEventListener("click", runQueueTest);
queueCount.addEventListener("change", normalizeQueueCount);
queueCount.addEventListener("blur", normalizeQueueCount);

queueSortField.addEventListener("change", () => {
  if (latestQueuePayload) {
    renderQueueTable(latestQueuePayload);
  }
});

queueSortDirButton.addEventListener("click", () => {
  setQueueSortDirection(queueSortDirection === "asc" ? "desc" : "asc");
  if (latestQueuePayload) {
    renderQueueTable(latestQueuePayload);
  } else {
    renderQueueSortIndicators();
  }
});

queueTableHeadCells.forEach((cell) => {
  cell.addEventListener("click", () => {
    const field = cell.dataset.sortField;
    if (!field) {
      return;
    }
    if (queueSortField.value === field) {
      setQueueSortDirection(queueSortDirection === "asc" ? "desc" : "asc");
    } else {
      queueSortField.value = field;
      setQueueSortDirection("asc");
    }
    if (latestQueuePayload) {
      renderQueueTable(latestQueuePayload);
    } else {
      renderQueueSortIndicators();
    }
  });
});

queueTableBody.addEventListener("dblclick", (event) => {
  const rowEl = event.target.closest("tr[data-queue-id]");
  if (!rowEl || !latestQueuePayload || !Array.isArray(latestQueuePayload.resultsById)) {
    return;
  }
  const id = Number.parseInt(rowEl.dataset.queueId, 10);
  if (!Number.isFinite(id)) {
    return;
  }
  const row = latestQueuePayload.resultsById.find((entry) => entry.id === id);
  if (!row) {
    return;
  }
  openInspector(
    `Queue Request #${id} (${row.source || "queue"})`,
    row.requestPayload || { request_id: id, started_at: row.startedAt },
    row.responsePayload || row.raw || { status_code: row.statusCode, preview: row.assistantPreview || row.error || "" }
  );
});

trafficTableBody.addEventListener("dblclick", (event) => {
  const rowEl = event.target.closest("tr[data-traffic-index]");
  if (!rowEl) {
    return;
  }
  const index = Number.parseInt(rowEl.dataset.trafficIndex, 10);
  if (!Number.isFinite(index) || !latestTrafficTableRows[index]) {
    return;
  }
  const row = latestTrafficTableRows[index];
  openInspector(
    `Traffic ${row.method || "-"} ${row.path || "-"}`,
    row.payload || {},
    row.response ? row.response.payload || row.response : { note: "No response payload" }
  );
});

queueViewTableButton.addEventListener("click", () => setQueueViewMode("table"));
queueViewJsonButton.addEventListener("click", () => setQueueViewMode("json"));

trafficViewTableButton.addEventListener("click", () => setTrafficViewMode("table"));
trafficViewJsonButton.addEventListener("click", () => setTrafficViewMode("json"));

toggleHealthTrafficButton.addEventListener("click", () => {
  showHealthTraffic = !showHealthTraffic;
  toggleHealthTrafficButton.textContent = showHealthTraffic ? "Hide Health" : "Show Health";
  loadTraffic();
});

inspectorCloseButton.addEventListener("click", closeInspector);
inspectorBackdrop.addEventListener("click", closeInspector);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !inspectorModal.classList.contains("hidden")) {
    closeInspector();
  }
});

handleAggressiveToggleChange();
normalizeQueueCount();
setQueueSortDirection("asc");
setQueueViewMode("table");
setTrafficViewMode("table");
renderQueueSortIndicators();
toggleHealthTrafficButton.textContent = "Show Health";
loadStatus();
loadModels();
loadTraffic();
startTrafficPolling();
