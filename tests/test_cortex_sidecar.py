from __future__ import annotations

import concurrent.futures
import importlib.util
import pathlib
import sys
from types import ModuleType


ROOT = pathlib.Path(__file__).resolve().parents[1]
CHATMOCK_SCRIPT = ROOT / "chatmock.py"


def load_sidecar_module() -> ModuleType:
    module_name = "chatmock_sidecar_under_test"
    spec = importlib.util.spec_from_file_location(module_name, CHATMOCK_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class FakeWorker:
    def __init__(self, *, completion: dict | None = None, error: Exception | None = None):
        self.completion = completion or {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 123,
            "model": "gpt-5-high",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            "_debug": {"markdown": "ok"},
        }
        self.error = error
        self.submitted = []

    def submit(self, payload):
        self.submitted.append(payload)
        fut = concurrent.futures.Future()
        if self.error is not None:
            fut.set_exception(self.error)
        else:
            fut.set_result(dict(self.completion))
        return fut


def test_parse_openai_payload_supports_text_and_image_url():
    mod = load_sidecar_module()
    parsed = mod.parse_openai_payload(
        {
            "model": "gpt-5-high",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "extract this"},
                        {"type": "image_url", "image_url": {"url": "https://example.com/snap.png"}},
                    ],
                }
            ],
        }
    )
    assert parsed is not None
    assert parsed.model == "gpt-5-high"
    assert parsed.prompt_text == "extract this"
    assert parsed.image_urls == ["https://example.com/snap.png"]


def test_parse_openai_payload_rejects_empty_messages():
    mod = load_sidecar_module()
    assert mod.parse_openai_payload({"model": "gpt-5-high", "messages": [{"role": "assistant", "content": "x"}]}) is None
    assert mod.parse_openai_payload({"messages": []}) is None


def test_build_model_list_toggles_reasoning_models():
    mod = load_sidecar_module()
    base = mod.build_model_list(False)
    expanded = mod.build_model_list(True)
    assert "gpt-5-high" not in base
    assert "gpt-5-high" in expanded
    assert len(expanded) > len(base)


def test_create_app_chat_completion_success_and_traffic_capture():
    mod = load_sidecar_module()
    worker = FakeWorker()
    app = mod.create_app(worker, expose_reasoning_models=True, traffic_max_entries=50)
    client = app.test_client()

    payload = {
        "model": "gpt-5-high",
        "messages": [{"role": "user", "content": "hello"}],
    }
    resp = client.post("/v1/chat/completions", json=payload)
    assert resp.status_code == 200
    data = resp.get_json()
    assert "_debug" not in data
    assert data["choices"][0]["message"]["content"] == "ok"

    traffic = client.get("/debug/traffic?limit=20")
    assert traffic.status_code == 200
    rows = traffic.get_json()["data"]
    assert any(row["path"] == "/v1/chat/completions" for row in rows)


def test_create_app_rejects_invalid_payload_and_handles_worker_error():
    mod = load_sidecar_module()
    app = mod.create_app(FakeWorker(error=RuntimeError("boom")), expose_reasoning_models=True, traffic_max_entries=50)
    client = app.test_client()

    bad = client.post("/v1/chat/completions", data="{bad", content_type="application/json")
    assert bad.status_code == 400

    missing_content = client.post("/v1/chat/completions", json={"messages": [{"role": "assistant", "content": "x"}]})
    assert missing_content.status_code == 400

    worker_fail = client.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "run"}]})
    assert worker_fail.status_code == 502
    assert "Worker failure" in worker_fail.get_json()["error"]["message"]


def test_create_app_models_and_health_and_clear_traffic():
    mod = load_sidecar_module()
    app = mod.create_app(FakeWorker(), expose_reasoning_models=True, traffic_max_entries=50)
    client = app.test_client()

    health = client.get("/health")
    assert health.status_code == 200
    assert health.get_json()["status"] == "ok"

    models = client.get("/v1/models")
    assert models.status_code == 200
    ids = [entry["id"] for entry in models.get_json()["data"]]
    assert "gpt-5-high" in ids

    client.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "x"}]})
    traffic_before_clear = client.get("/debug/traffic?limit=100").get_json()["data"]
    assert not any(row["path"] == "/health" for row in traffic_before_clear)
    clear_resp = client.delete("/debug/traffic")
    assert clear_resp.status_code == 200
    assert clear_resp.get_json()["ok"] is True
