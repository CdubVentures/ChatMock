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
const refreshTrafficButton = document.getElementById("refreshTrafficButton");
const clearTrafficButton = document.getElementById("clearTrafficButton");

let thinkingTimer = null;
let trafficPollTimer = null;

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
    request_payload: row.payload,
    response_payload: row.response ? row.response.payload : null
  };
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
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const simplified = rows.map(simplifyTrafficRow);
    trafficOutput.textContent = JSON.stringify(simplified, null, 2);
    trafficStatus.textContent = `Traffic records: ${rows.length}`;
    trafficStatus.classList.remove("error");
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
  if (!forwardedRequest) {
    requestOutput.textContent = "{}";
    return;
  }
  requestOutput.textContent = JSON.stringify(forwardedRequest, null, 2);
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
    rawOutput.textContent = JSON.stringify(payload.raw, null, 2);
    renderedOutput.innerHTML = payload.renderedHtml || "<p class=\"placeholder\">No renderable content returned.</p>";
    updateStatus(`Completed with model ${payload.model}.`);
  } catch (error) {
    renderedOutput.innerHTML = "<p class=\"placeholder\">No result due to an error.</p>";
    updateStatus(error.message || "Request failed.", "error");
  } finally {
    stopThinkingTimer();
    runButton.disabled = false;
    loadStatus();
  }
}

runButton.addEventListener("click", runExtraction);
aggressiveToggle.addEventListener("change", handleAggressiveToggleChange);
refreshTrafficButton.addEventListener("click", loadTraffic);
clearTrafficButton.addEventListener("click", clearTraffic);

handleAggressiveToggleChange();
loadStatus();
loadModels();
loadTraffic();
startTrafficPolling();
