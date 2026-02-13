from __future__ import annotations

import datetime
import json
import time
import uuid

from flask import Flask, jsonify
from flask import g, request

from .config import BASE_INSTRUCTIONS, GPT5_CODEX_INSTRUCTIONS
from .http import build_cors_headers
from .routes_openai import openai_bp
from .routes_ollama import ollama_bp
from .traffic import TrafficLog


def _truncate_text(value: str, limit: int = 4000) -> str:
    if not isinstance(value, str):
        return ""
    if len(value) <= limit:
        return value
    return value[:limit] + "... [truncated]"


def _safe_headers(headers) -> dict:
    allowed = ("content-type", "user-agent", "x-request-id", "x-session-id", "session_id")
    out = {}
    for key, val in headers.items():
        lower = key.lower()
        if lower == "authorization":
            out[key] = "<redacted>"
        elif lower in allowed:
            out[key] = val
    return out


def create_app(
    verbose: bool = False,
    verbose_obfuscation: bool = False,
    reasoning_effort: str = "medium",
    reasoning_summary: str = "auto",
    reasoning_compat: str = "think-tags",
    debug_model: str | None = None,
    expose_reasoning_models: bool = False,
    default_web_search: bool = False,
    aggressive_mode: bool = False,
    request_queue_enabled: bool = True,
    upstream_timeout: float | None = 600.0,
    headed: bool = False,
    traffic_log_enabled: bool = True,
    traffic_max_entries: int = 300,
) -> Flask:
    app = Flask(__name__)
    traffic_log = TrafficLog(max_entries=traffic_max_entries)
    app.extensions["traffic_log"] = traffic_log

    app.config.update(
        VERBOSE=bool(verbose),
        VERBOSE_OBFUSCATION=bool(verbose_obfuscation),
        REASONING_EFFORT=reasoning_effort,
        REASONING_SUMMARY=reasoning_summary,
        REASONING_COMPAT=reasoning_compat,
        DEBUG_MODEL=debug_model,
        BASE_INSTRUCTIONS=BASE_INSTRUCTIONS,
        GPT5_CODEX_INSTRUCTIONS=GPT5_CODEX_INSTRUCTIONS,
        EXPOSE_REASONING_MODELS=bool(expose_reasoning_models),
        DEFAULT_WEB_SEARCH=bool(default_web_search),
        AGGRESSIVE_MODE=bool(aggressive_mode),
        REQUEST_QUEUE_ENABLED=bool(request_queue_enabled),
        UPSTREAM_TIMEOUT=upstream_timeout,
        HEADED=bool(headed),
        TRAFFIC_LOG_ENABLED=bool(traffic_log_enabled),
        TRAFFIC_MAX_ENTRIES=max(1, int(traffic_max_entries)),
    )

    @app.get("/")
    @app.get("/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/debug/traffic")
    def debug_traffic():
        limit = request.args.get("limit", default=100, type=int)
        rows = traffic_log.recent(limit=limit)
        return jsonify({"count": len(rows), "data": rows})

    @app.delete("/debug/traffic")
    def clear_debug_traffic():
        traffic_log.clear()
        return jsonify({"ok": True})

    @app.before_request
    def _capture_request():
        if not bool(app.config.get("TRAFFIC_LOG_ENABLED", True)):
            return None
        if request.path.startswith("/debug/traffic"):
            return None

        request_id = uuid.uuid4().hex
        g.traffic_request_id = request_id
        g.traffic_start_ts = time.perf_counter()

        payload_preview = None
        raw_body = ""
        try:
            raw_body = request.get_data(cache=True, as_text=True) or ""
        except Exception:
            raw_body = ""

        if raw_body:
            try:
                payload_preview = json.loads(raw_body)
            except Exception:
                payload_preview = _truncate_text(raw_body)

        traffic_log.record_request(
            {
                "request_id": request_id,
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "method": request.method,
                "path": request.path,
                "query": request.query_string.decode("utf-8", errors="ignore") if request.query_string else "",
                "remote_addr": request.remote_addr,
                "headers": _safe_headers(request.headers),
                "payload": payload_preview,
                "response": None,
            }
        )
        return None

    @app.after_request
    def _cors(resp):
        if bool(app.config.get("TRAFFIC_LOG_ENABLED", True)) and not request.path.startswith("/debug/traffic"):
            request_id = getattr(g, "traffic_request_id", None)
            started = getattr(g, "traffic_start_ts", None)
            duration_ms = None
            if isinstance(started, (int, float)):
                duration_ms = round((time.perf_counter() - started) * 1000.0, 2)

            response_preview = None
            if not resp.is_streamed:
                try:
                    content_type = resp.headers.get("Content-Type", "")
                    body_text = resp.get_data(as_text=True) or ""
                    if "application/json" in content_type:
                        try:
                            response_preview = json.loads(body_text)
                        except Exception:
                            response_preview = _truncate_text(body_text)
                    else:
                        response_preview = _truncate_text(body_text)
                except Exception:
                    response_preview = None

            traffic_log.record_response(
                str(request_id or ""),
                {
                    "status_code": int(resp.status_code),
                    "duration_ms": duration_ms,
                    "is_streamed": bool(resp.is_streamed),
                    "content_type": resp.headers.get("Content-Type", ""),
                    "payload": response_preview,
                },
            )

        for k, v in build_cors_headers().items():
            resp.headers.setdefault(k, v)
        return resp

    app.register_blueprint(openai_bp)
    app.register_blueprint(ollama_bp)

    return app
