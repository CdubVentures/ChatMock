function resolveSidecarState({
  now = Date.now(),
  connectivityOk = false,
  signals = {},
  queueSnapshot = { depth: { total: 0 } },
  metricsSummary = {}
}) {
  const reasons = [];
  const authUntil = Number(signals.auth_required_until || 0);
  const challengeUntil = Number(signals.challenge_until || 0);
  const rateUntil = Number(signals.rate_limited_until || 0);
  const degradedUntil = Number(signals.degraded_until || 0);
  const queueDepth = Number(queueSnapshot && queueSnapshot.depth && queueSnapshot.depth.total) || 0;
  const errorRate = Number(metricsSummary.error_rate || 0);

  if (authUntil > now) {
    reasons.push("auth_required_signal");
    return { state: "auth_required", reasons, queue_depth: queueDepth, error_rate: errorRate };
  }
  if (challengeUntil > now) {
    reasons.push("challenge_signal");
    return { state: "challenge", reasons, queue_depth: queueDepth, error_rate: errorRate };
  }
  if (rateUntil > now) {
    reasons.push("rate_limited_signal");
    return { state: "rate_limited", reasons, queue_depth: queueDepth, error_rate: errorRate };
  }
  if (!connectivityOk) {
    reasons.push("connectivity_check_failed");
    return { state: "degraded", reasons, queue_depth: queueDepth, error_rate: errorRate };
  }
  if (degradedUntil > now) {
    reasons.push("degraded_cooldown");
    return { state: "degraded", reasons, queue_depth: queueDepth, error_rate: errorRate };
  }
  return { state: "ready", reasons, queue_depth: queueDepth, error_rate: errorRate };
}

module.exports = {
  resolveSidecarState
};
