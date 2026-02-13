from __future__ import annotations

import asyncio
import importlib.util
import pathlib
import sys
from types import ModuleType


ROOT = pathlib.Path(__file__).resolve().parents[1]
CHATMOCK_SCRIPT = ROOT / "chatmock.py"


def load_sidecar_module() -> ModuleType:
    module_name = "chatmock_sidecar_worker_injection_test"
    spec = importlib.util.spec_from_file_location(module_name, CHATMOCK_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_inject_prompt_falls_back_to_clipboard_when_fill_fails():
    mod = load_sidecar_module()
    worker = mod.PlaywrightWorker(user_data_dir="/tmp/auth", chat_url="https://chatgpt.com/", headed=False)

    state = {"fill_called": 0, "clipboard_called": 0}

    async def fail_fill(_prompt: str) -> None:
        state["fill_called"] += 1
        raise RuntimeError("Prompt input not found.")

    async def clipboard_ok(_prompt: str) -> bool:
        state["clipboard_called"] += 1
        return True

    worker._inject_fill = fail_fill
    worker._inject_clipboard = clipboard_ok

    asyncio.run(worker._inject_prompt("short prompt"))
    assert state["fill_called"] == 1
    assert state["clipboard_called"] == 1


def test_inject_prompt_raises_if_fill_and_clipboard_fail():
    mod = load_sidecar_module()
    worker = mod.PlaywrightWorker(user_data_dir="/tmp/auth", chat_url="https://chatgpt.com/", headed=False)

    async def fail_fill(_prompt: str) -> None:
        raise RuntimeError("Prompt input not found.")

    async def clipboard_fail(_prompt: str) -> bool:
        return False

    worker._inject_fill = fail_fill
    worker._inject_clipboard = clipboard_fail

    try:
        asyncio.run(worker._inject_prompt("short prompt"))
        assert False, "Expected RuntimeError"
    except RuntimeError as exc:
        assert "Prompt input not found" in str(exc)
