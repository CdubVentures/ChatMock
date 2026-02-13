(() => {
  const defaults = ["gpt-4o", "gpt-4-turbo", "gpt-5", "gpt-5-high", "gpt-5-codex", "o1"];

  const asyncPanel = {
    tabJobsButton: document.getElementById("asyncTabJobsButton"),
    tabReplayButton: document.getElementById("asyncTabReplayButton"),
    refreshAllButton: document.getElementById("asyncRefreshAllButton"),
    jobsPane: document.getElementById("asyncJobsPane"),
    replayPane: document.getElementById("asyncReplayPane"),
    status: document.getElementById("asyncStatus"),
    modelSelect: document.getElementById("asyncModelSelect"),
    prioritySelect: document.getElementById("asyncPrioritySelect"),
    aggressiveToggle: document.getElementById("asyncAggressiveToggle"),
    fallbackReason: document.getElementById("asyncFallbackReason"),
    confidenceBefore: document.getElementById("asyncConfidenceBefore"),
    domAnchor: document.getElementById("asyncDomAnchor"),
    screenshotRegion: document.getElementById("asyncScreenshotRegion"),
    reasoningNote: document.getElementById("asyncReasoningNote"),
    payloadInput: document.getElementById("asyncPayloadInput"),
    useCurrentInputButton: document.getElementById("asyncUseCurrentInputButton"),
    submitButton: document.getElementById("asyncSubmitButton"),
    jobIdInput: document.getElementById("asyncJobIdInput"),
    statusButton: document.getElementById("asyncStatusButton"),
    resultButton: document.getElementById("asyncResultButton"),
    reviewButton: document.getElementById("asyncReviewButton"),
    cancelButton: document.getElementById("asyncCancelButton"),
    queueOutput: document.getElementById("asyncQueueOutput"),
    stateOutput: document.getElementById("asyncStateOutput"),
    metricsOutput: document.getElementById("asyncMetricsOutput"),
    aggressiveOutput: document.getElementById("asyncAggressiveOutput"),
    jobOutput: document.getElementById("asyncJobOutput"),
    refreshStateButton: document.getElementById("asyncRefreshStateButton"),
    refreshMetricsButton: document.getElementById("asyncRefreshMetricsButton"),
    refreshAggressiveButton: document.getElementById("asyncRefreshAggressiveButton"),
    replayNameInput: document.getElementById("replayNameInput"),
    replayBaselineModel: document.getElementById("replayBaselineModel"),
    replayCandidateModel: document.getElementById("replayCandidateModel"),
    replayCasesInput: document.getElementById("replayCasesInput"),
    replayUseCurrentInputButton: document.getElementById("replayUseCurrentInputButton"),
    replayRunButton: document.getElementById("replayRunButton"),
    replayIdInput: document.getElementById("replayIdInput"),
    replayLoadButton: document.getElementById("replayLoadButton"),
    replayOutput: document.getElementById("replayOutput")
  };

  if (!asyncPanel.tabJobsButton || !asyncPanel.submitButton) {
    return;
  }

  function setStatus(message, mode = "idle") {
    asyncPanel.status.textContent = message;
    asyncPanel.status.classList.remove("busy", "error");
    if (mode === "busy") {
      asyncPanel.status.classList.add("busy");
    }
    if (mode === "error") {
      asyncPanel.status.classList.add("error");
    }
  }

  function stringify(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_error) {
      return JSON.stringify({ error: "Unable to render payload." }, null, 2);
    }
  }

  function parseJsonInput(raw, label) {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (error) {
      setStatus(`${label} JSON is invalid: ${error.message}`, "error");
      return { ok: false, value: null };
    }
  }

  function setTab(tab) {
    const replay = tab === "replay";
    asyncPanel.jobsPane.classList.toggle("hidden", replay);
    asyncPanel.replayPane.classList.toggle("hidden", !replay);
    asyncPanel.tabJobsButton.classList.toggle("active", !replay);
    asyncPanel.tabReplayButton.classList.toggle("active", replay);
  }

  function setLoading(button, loading) {
    if (!button) {
      return;
    }
    button.disabled = Boolean(loading);
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = { error: "Response was not valid JSON." };
    }
    return { ok: response.ok, status: response.status, payload };
  }

  function readMainInputText() {
    const input = document.getElementById("inputText");
    return input && typeof input.value === "string" && input.value.trim()
      ? input.value.trim()
      : "Extract key fields from this input.";
  }

  function readMainModel() {
    const select = document.getElementById("modelSelect");
    return select && typeof select.value === "string" && select.value
      ? select.value
      : "gpt-5-high";
  }

  function buildDefaultAsyncPayload() {
    return {
      model: asyncPanel.modelSelect.value || readMainModel(),
      messages: [
        {
          role: "user",
          content: readMainInputText()
        }
      ],
      stream: false
    };
  }

  function buildDefaultReplayCases() {
    return [
      {
        id: "case-1",
        payload: {
          messages: [
            {
              role: "user",
              content: readMainInputText()
            }
          ],
          stream: false
        },
        expected: {}
      }
    ];
  }

  function updateModelSelect(select, models, preferred) {
    if (!select) {
      return;
    }
    const current = select.value;
    select.innerHTML = "";
    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      select.appendChild(option);
    });

    if (current && models.includes(current)) {
      select.value = current;
      return;
    }
    if (preferred && models.includes(preferred)) {
      select.value = preferred;
      return;
    }
    if (models.length > 0) {
      select.value = models[0];
    }
  }

  async function loadModels() {
    try {
      const { ok, payload } = await requestJson("/api/models");
      const models = ok && payload && Array.isArray(payload.models)
        ? [...new Set(payload.models)].sort((a, b) => a.localeCompare(b))
        : defaults;
      updateModelSelect(asyncPanel.modelSelect, models, readMainModel());
      updateModelSelect(asyncPanel.replayBaselineModel, models, "gpt-4o");
      updateModelSelect(asyncPanel.replayCandidateModel, models, "gpt-5-high");
    } catch (_error) {
      const models = [...defaults];
      updateModelSelect(asyncPanel.modelSelect, models, readMainModel());
      updateModelSelect(asyncPanel.replayBaselineModel, models, "gpt-4o");
      updateModelSelect(asyncPanel.replayCandidateModel, models, "gpt-5-high");
    }
  }

  function syncAsyncPayloadFromMain() {
    asyncPanel.payloadInput.value = stringify(buildDefaultAsyncPayload());
    setStatus("Payload filled from current input.");
  }

  function syncReplayFromMain() {
    asyncPanel.replayCasesInput.value = stringify(buildDefaultReplayCases());
    setStatus("Replay cases filled from current input.");
  }

  function readAggressive() {
    const enabled = Boolean(asyncPanel.aggressiveToggle.checked);
    const confidence = Number.parseFloat(asyncPanel.confidenceBefore.value);
    return {
      enabled,
      fallbackReason: asyncPanel.fallbackReason.value.trim() || null,
      confidenceBefore: Number.isFinite(confidence) ? confidence : null
    };
  }

  async function submitJob() {
    const parsed = parseJsonInput(asyncPanel.payloadInput.value, "Payload");
    if (!parsed.ok) {
      return;
    }
    const payload = parsed.value;
    if (!payload.model) {
      payload.model = asyncPanel.modelSelect.value || readMainModel();
    }

    const body = {
      payload,
      priority: asyncPanel.prioritySelect.value || "batch",
      aggressive: readAggressive(),
      domAnchor: asyncPanel.domAnchor.value.trim() || null,
      screenshotRegion: asyncPanel.screenshotRegion.value.trim() || null,
      reasoningNote: asyncPanel.reasoningNote.value.trim() || null
    };

    setLoading(asyncPanel.submitButton, true);
    setStatus("Submitting async job...", "busy");
    try {
      const { ok, status, payload: resPayload } = await requestJson("/api/async/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      asyncPanel.jobOutput.textContent = stringify(resPayload);
      if (!ok) {
        setStatus(`Submit failed (${status}).`, "error");
        return;
      }
      if (resPayload && resPayload.job_id) {
        asyncPanel.jobIdInput.value = resPayload.job_id;
      }
      setStatus("Async job submitted.");
      refreshAll();
    } catch (error) {
      setStatus(`Submit failed: ${error.message}`, "error");
    } finally {
      setLoading(asyncPanel.submitButton, false);
    }
  }

  function requireJobId() {
    const jobId = asyncPanel.jobIdInput.value.trim();
    if (!jobId) {
      setStatus("Job ID is required.", "error");
      return null;
    }
    return jobId;
  }

  async function fetchJobEndpoint(path, method = "GET") {
    const jobId = requireJobId();
    if (!jobId) {
      return;
    }
    setStatus(`Calling ${path}...`, "busy");
    const url = `/api/async/${path}/${encodeURIComponent(jobId)}`;
    const { ok, status, payload } = await requestJson(url, { method });
    asyncPanel.jobOutput.textContent = stringify(payload);
    if (!ok) {
      setStatus(`${path} failed (${status}).`, "error");
      return;
    }
    setStatus(`${path} complete.`);
    if (path === "result" || path === "cancel") {
      refreshAll();
    }
  }

  async function refreshQueue() {
    const { ok, payload } = await requestJson("/api/async/queue");
    asyncPanel.queueOutput.textContent = stringify(payload);
    return ok;
  }

  async function refreshState() {
    const { ok, payload } = await requestJson("/api/async/state");
    asyncPanel.stateOutput.textContent = stringify(payload);
    return ok;
  }

  async function refreshMetrics() {
    const { ok, payload } = await requestJson("/api/async/metrics");
    asyncPanel.metricsOutput.textContent = stringify(payload);
    return ok;
  }

  async function refreshAggressive() {
    const { ok, payload } = await requestJson("/api/async/aggressive/report");
    asyncPanel.aggressiveOutput.textContent = stringify(payload);
    return ok;
  }

  async function refreshAll() {
    setStatus("Refreshing async queue/state/metrics...", "busy");
    const results = await Promise.allSettled([
      refreshQueue(),
      refreshState(),
      refreshMetrics(),
      refreshAggressive()
    ]);
    const hasError = results.some((entry) => entry.status !== "fulfilled" || entry.value !== true);
    if (hasError) {
      setStatus("Some async dashboard calls failed.", "error");
    } else {
      setStatus("Async dashboard refreshed.");
    }
  }

  async function runReplay() {
    const parsed = parseJsonInput(asyncPanel.replayCasesInput.value, "Replay cases");
    if (!parsed.ok) {
      return;
    }
    if (!Array.isArray(parsed.value)) {
      setStatus("Replay cases must be a JSON array.", "error");
      return;
    }
    const body = {
      replayName: asyncPanel.replayNameInput.value.trim() || "default-replay",
      baselineModel: asyncPanel.replayBaselineModel.value,
      candidateModel: asyncPanel.replayCandidateModel.value,
      cases: parsed.value
    };
    setLoading(asyncPanel.replayRunButton, true);
    setStatus("Running replay harness...", "busy");
    try {
      const { ok, status, payload } = await requestJson("/api/replay/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      asyncPanel.replayOutput.textContent = stringify(payload);
      if (!ok) {
        setStatus(`Replay failed (${status}).`, "error");
        return;
      }
      if (payload && payload.replay_id) {
        asyncPanel.replayIdInput.value = payload.replay_id;
      }
      setStatus("Replay run complete.");
      refreshMetrics();
    } catch (error) {
      setStatus(`Replay failed: ${error.message}`, "error");
    } finally {
      setLoading(asyncPanel.replayRunButton, false);
    }
  }

  async function loadReplayReport() {
    const replayId = asyncPanel.replayIdInput.value.trim();
    if (!replayId) {
      setStatus("Replay ID is required.", "error");
      return;
    }
    setStatus("Loading replay report...", "busy");
    const { ok, status, payload } = await requestJson(`/api/replay/report/${encodeURIComponent(replayId)}`);
    asyncPanel.replayOutput.textContent = stringify(payload);
    if (!ok) {
      setStatus(`Load replay report failed (${status}).`, "error");
      return;
    }
    setStatus("Replay report loaded.");
  }

  asyncPanel.tabJobsButton.addEventListener("click", () => setTab("jobs"));
  asyncPanel.tabReplayButton.addEventListener("click", () => setTab("replay"));
  asyncPanel.refreshAllButton.addEventListener("click", refreshAll);

  asyncPanel.useCurrentInputButton.addEventListener("click", syncAsyncPayloadFromMain);
  asyncPanel.submitButton.addEventListener("click", submitJob);
  asyncPanel.statusButton.addEventListener("click", () => fetchJobEndpoint("status"));
  asyncPanel.resultButton.addEventListener("click", () => fetchJobEndpoint("result"));
  asyncPanel.reviewButton.addEventListener("click", () => fetchJobEndpoint("review"));
  asyncPanel.cancelButton.addEventListener("click", () => fetchJobEndpoint("cancel", "POST"));

  asyncPanel.refreshStateButton.addEventListener("click", refreshState);
  asyncPanel.refreshMetricsButton.addEventListener("click", refreshMetrics);
  asyncPanel.refreshAggressiveButton.addEventListener("click", refreshAggressive);

  asyncPanel.replayUseCurrentInputButton.addEventListener("click", syncReplayFromMain);
  asyncPanel.replayRunButton.addEventListener("click", runReplay);
  asyncPanel.replayLoadButton.addEventListener("click", loadReplayReport);

  setTab("jobs");
  loadModels();
  syncAsyncPayloadFromMain();
  syncReplayFromMain();
  refreshAll();
})();
