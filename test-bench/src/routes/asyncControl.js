const express = require("express");
const { ERROR_CODES, buildApiError, classifyError } = require("../services/async/errorCodes");

const router = express.Router();

function getControlPlane(req) {
  return req.app.locals.asyncControlPlane;
}

function sendApiError(res, errorLike) {
  const classified = classifyError(errorLike);
  const payload = buildApiError({
    code: classified.code,
    message: classified.message,
    status: classified.status,
    retryable: classified.retryable
  });
  return res.status(payload.status).json(payload);
}

router.post("/async/submit", (req, res) => {
  const controlPlane = getControlPlane(req);
  try {
    const submitted = controlPlane.submit(req.body || {});
    return res.status(202).json(submitted);
  } catch (error) {
    if (error && error.code === ERROR_CODES.INVALID_REQUEST) {
      const payload = buildApiError({
        code: ERROR_CODES.INVALID_REQUEST,
        message: error.message || "Invalid request payload.",
        status: 400
      });
      return res.status(payload.status).json(payload);
    }
    if (error && error.code === ERROR_CODES.QUEUE_BACKPRESSURE) {
      const payload = buildApiError({
        code: ERROR_CODES.QUEUE_BACKPRESSURE,
        message: error.message || "Queue is full.",
        status: 429,
        retryable: true
      });
      return res.status(payload.status).json(payload);
    }
    return sendApiError(res, error);
  }
});

router.get("/async/status/:jobId", (req, res) => {
  const controlPlane = getControlPlane(req);
  const status = controlPlane.getStatus(req.params.jobId);
  if (!status) {
    const payload = buildApiError({
      code: ERROR_CODES.JOB_NOT_FOUND,
      message: "Job not found.",
      status: 404
    });
    return res.status(payload.status).json(payload);
  }
  return res.json(status);
});

router.get("/async/result/:jobId", (req, res) => {
  const controlPlane = getControlPlane(req);
  const result = controlPlane.getResult(req.params.jobId);
  if (result) {
    return res.status(200).json(result);
  }
  const status = controlPlane.getStatus(req.params.jobId);
  if (!status) {
    const payload = buildApiError({
      code: ERROR_CODES.JOB_NOT_FOUND,
      message: "Job not found.",
      status: 404
    });
    return res.status(payload.status).json(payload);
  }
  return res.status(202).json({
    job_id: req.params.jobId,
    status: status.status || "queued"
  });
});

router.post("/async/cancel/:jobId", (req, res) => {
  const controlPlane = getControlPlane(req);
  const result = controlPlane.cancel(req.params.jobId);
  if (!result || result.code === ERROR_CODES.JOB_NOT_FOUND) {
    const payload = buildApiError({
      code: ERROR_CODES.JOB_NOT_FOUND,
      message: "Job not found.",
      status: 404
    });
    return res.status(payload.status).json(payload);
  }
  return res.status(200).json({
    ok: typeof result.ok === "boolean" ? result.ok : Boolean(result.cancelled),
    job_id: req.params.jobId,
    status: result.status || "cancel_requested",
    running: Boolean(result.running)
  });
});

router.get("/async/queue", (req, res) => {
  const controlPlane = getControlPlane(req);
  return res.json(controlPlane.getQueueSnapshot());
});

router.get("/async/state", async (req, res) => {
  const controlPlane = getControlPlane(req);
  try {
    const state = await controlPlane.getState();
    return res.json(state);
  } catch (error) {
    return sendApiError(res, error);
  }
});

router.get("/async/metrics", (req, res) => {
  const controlPlane = getControlPlane(req);
  return res.json(controlPlane.getMetrics());
});

router.get("/async/aggressive/report", (req, res) => {
  const controlPlane = getControlPlane(req);
  const metrics = controlPlane.getMetrics();
  return res.json({
    aggressive: metrics && metrics.metrics && metrics.metrics.aggressive
      ? metrics.metrics.aggressive
      : {
        triggered: 0,
        improved: 0,
        win_rate: 0,
        by_fallback_reason: {}
      }
  });
});

router.get("/async/review/:jobId", (req, res) => {
  const controlPlane = getControlPlane(req);
  const payload = controlPlane.getReviewPayload(req.params.jobId);
  if (!payload) {
    const err = buildApiError({
      code: ERROR_CODES.JOB_NOT_FOUND,
      message: "Review payload not found.",
      status: 404
    });
    return res.status(err.status).json(err);
  }
  return res.json(payload);
});

router.post("/replay/run", async (req, res) => {
  const controlPlane = getControlPlane(req);
  const body = req.body || {};
  if (!body.baselineModel || !body.candidateModel || !Array.isArray(body.cases)) {
    const err = buildApiError({
      code: ERROR_CODES.INVALID_REQUEST,
      message: "baselineModel, candidateModel, and cases[] are required.",
      status: 400
    });
    return res.status(err.status).json(err);
  }
  try {
    const report = await controlPlane.runReplay(body);
    return res.json(report);
  } catch (error) {
    return sendApiError(res, error);
  }
});

router.get("/replay/report/:replayId", (req, res) => {
  const controlPlane = getControlPlane(req);
  const report = controlPlane.getReplayReport(req.params.replayId);
  if (!report) {
    const err = buildApiError({
      code: ERROR_CODES.JOB_NOT_FOUND,
      message: "Replay report not found.",
      status: 404
    });
    return res.status(err.status).json(err);
  }
  return res.json(report);
});

module.exports = router;
