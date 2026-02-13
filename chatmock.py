from __future__ import annotations

import argparse
import asyncio
import base64
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from flask import Flask, Response, g, jsonify, make_response, request
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright


CHAT_URL_DEFAULT = "https://chatgpt.com/"
DEFAULT_MODEL = "gpt-5-high"
TIMEOUT_SECONDS = 600.0
PROMPT_CLIPBOARD_THRESHOLD = 1000
WATCHDOG_INTERVAL_SECONDS = 10.0

BLOCKED_RESOURCE_TYPES = {"image", "media", "font"}
BLOCKED_DOMAINS = {
    "google-analytics.com",
    "googletagmanager.com",
    "sentry.io",
    "segment.io",
    "doubleclick.net",
    "hotjar.com",
}
RATE_LIMIT_MARKERS = ("rate limit", "too many requests", "try again later", "temporarily blocked")
CHALLENGE_MARKERS = ("just a moment", "verify you are human", "checking your browser", "cf-challenge")

TEXTAREA_SELECTORS = [
    "#prompt-textarea",
    "textarea[data-testid='prompt-textarea']",
    "textarea[placeholder*='Message']",
    "textarea",
]
EDITABLE_SELECTORS = [
    "div[data-testid='composer-input'][contenteditable='true']",
    "div[contenteditable='true'][role='textbox']",
    "div[role='textbox'][contenteditable='true']",
    "[data-lexical-editor='true']",
    ".ProseMirror",
    "[contenteditable='true']",
    "[contenteditable='plaintext-only']",
]
SEND_BUTTON_SELECTORS = [
    "button[data-testid='send-button']",
    "button[aria-label*='Send']",
    "button[aria-label*='send']",
]
ASSISTANT_SELECTORS = [
    "[data-message-author-role='assistant']",
    "article[data-testid*='conversation-turn']",
]
MARKDOWN_SELECTORS = [
    ".markdown",
    "[data-testid='markdown']",
    "pre code.language-markdown",
    "code.language-markdown",
]
THINKING_SELECTORS = [
    "text=Thinking",
    "text=Reasoning",
    "[aria-label*='Thinking']",
    "[aria-label*='Reasoning']",
    "[data-testid*='thinking']",
]
UPLOAD_READY_SELECTORS = [
    "img[src^='blob:']",
    "[data-testid*='attachment']",
    "[data-testid*='upload']",
]


def _bool_env(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


def _safe_headers(headers: Any) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k, v in headers.items():
        lk = k.lower()
        if lk == "authorization":
            out[k] = "<redacted>"
        elif lk in {"content-type", "user-agent", "x-request-id"}:
            out[k] = v
    return out


class TrafficLog:
    def __init__(self, max_entries: int) -> None:
        self._rows: deque[Dict[str, Any]] = deque(maxlen=max(1, max_entries))
        self._lock = threading.Lock()

    def add_request(self, row: Dict[str, Any]) -> None:
        with self._lock:
            self._rows.append(row)

    def add_response(self, req_id: str, response: Dict[str, Any]) -> None:
        with self._lock:
            for row in reversed(self._rows):
                if row.get("request_id") == req_id:
                    row["response"] = response
                    break

    def recent(self, limit: int) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._rows)[-max(1, limit):]

    def clear(self) -> None:
        with self._lock:
            self._rows.clear()


@dataclass
class JobPayload:
    model: str
    prompt_text: str
    image_urls: List[str]


@dataclass
class QueueJob:
    payload: JobPayload
    future: concurrent.futures.Future
    job_id: str


class PlaywrightWorker:
    def __init__(self, *, user_data_dir: str, chat_url: str, headed: bool) -> None:
        self.user_data_dir = user_data_dir
        self.chat_url = chat_url
        self.headed = headed
        self.timeout_ms = int(TIMEOUT_SECONDS * 1000)

        self._thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._ready = threading.Event()
        self._stop = threading.Event()

        self._playwright = None
        self._context = None
        self._page = None
        self._queue: Optional[asyncio.Queue] = None
        self._job_task: Optional[asyncio.Task] = None
        self._watchdog_task: Optional[asyncio.Task] = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="cortex-worker")
        self._thread.start()
        if not self._ready.wait(timeout=90):
            raise RuntimeError("Cortex worker initialization timed out.")

    def stop(self) -> None:
        self._stop.set()
        if self._loop and self._queue:
            self._loop.call_soon_threadsafe(lambda: self._queue.put_nowait(None))
        if self._thread:
            self._thread.join(timeout=25)

    def submit(self, payload: JobPayload) -> concurrent.futures.Future:
        if not self._loop or not self._queue:
            raise RuntimeError("Worker not ready.")
        future: concurrent.futures.Future = concurrent.futures.Future()
        job = QueueJob(payload=payload, future=future, job_id=uuid.uuid4().hex)
        self._loop.call_soon_threadsafe(lambda: self._queue.put_nowait(job))
        return future

    def diagnostics(self) -> Dict[str, Any]:
        if not self._loop:
            return {"ready": False, "error": "Worker loop not initialized."}
        fut = asyncio.run_coroutine_threadsafe(self._diagnostics(), self._loop)
        return fut.result(timeout=10.0)

    def _run_loop(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._bootstrap())
        self._ready.set()
        try:
            self._loop.run_forever()
        finally:
            self._loop.run_until_complete(self._shutdown())
            self._loop.close()

    async def _bootstrap(self) -> None:
        os.makedirs(self.user_data_dir, exist_ok=True)
        self._playwright = await async_playwright().start()
        self._queue = asyncio.Queue()
        await self._restart_context("bootstrap")
        self._job_task = asyncio.create_task(self._job_loop())
        self._watchdog_task = asyncio.create_task(self._watchdog_loop())

    async def _shutdown(self) -> None:
        for task in (self._job_task, self._watchdog_task):
            if task:
                task.cancel()
                try:
                    await task
                except Exception:
                    pass
        await self._close_context()
        if self._playwright:
            await self._playwright.stop()

    async def _close_context(self) -> None:
        if self._context:
            try:
                await self._context.close()
            except Exception:
                pass
        self._context = None
        self._page = None

    async def _restart_context(self, reason: str) -> None:
        _ = reason
        await self._close_context()
        ctx = await self._playwright.chromium.launch_persistent_context(
            self.user_data_dir,
            headless=not self.headed,
            viewport={"width": 1500, "height": 980},
            args=["--disable-blink-features=AutomationControlled"],
        )
        ctx.set_default_timeout(self.timeout_ms)
        ctx.set_default_navigation_timeout(self.timeout_ms)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.route("**/*", self._route_handler)
        await page.goto(self.chat_url, wait_until="domcontentloaded", timeout=self.timeout_ms)
        self._context = ctx
        self._page = page

    async def _route_handler(self, route, req) -> None:
        try:
            host = (urllib.parse.urlparse(req.url).hostname or "").lower()
            rtype = (req.resource_type or "").lower()
            if any(d in host for d in BLOCKED_DOMAINS) or rtype in BLOCKED_RESOURCE_TYPES:
                await route.abort()
                return
        except Exception:
            pass
        await route.continue_()

    async def _watchdog_loop(self) -> None:
        while not self._stop.is_set():
            await asyncio.sleep(WATCHDOG_INTERVAL_SECONDS)
            if self._page is None or self._page.is_closed():
                await self._restart_context("watchdog: page missing/closed")
                continue
            try:
                await asyncio.wait_for(self._page.evaluate("() => document.readyState"), timeout=4.0)
            except Exception:
                await self._restart_context("watchdog: renderer freeze")

    async def _job_loop(self) -> None:
        while not self._stop.is_set():
            job = await self._queue.get()
            if job is None:
                self._queue.task_done()
                break
            try:
                result = await self._run_job_with_recovery(job)
                job.future.set_result(result)
            except Exception as exc:
                job.future.set_exception(exc)
            finally:
                self._queue.task_done()

    async def _run_job_with_recovery(self, job: QueueJob) -> Dict[str, Any]:
        for attempt in range(2):
            try:
                return await self._run_job(job)
            except Exception as exc:
                recoverable = any(s in str(exc).lower() for s in ("target closed", "timed out", "rate limit", "context"))
                if attempt == 0 and recoverable:
                    await self._restart_context(f"recover: {exc}")
                    continue
                raise
        raise RuntimeError("Unreachable job recovery state.")

    async def _run_job(self, job: QueueJob) -> Dict[str, Any]:
        if not self._page:
            await self._restart_context("job: no page")
        assert self._page is not None
        await self._ensure_ready()
        await self._check_rate_limit()
        await self._select_model(job.payload.model)
        image_paths = await self._materialize_images(job.payload.image_urls)
        try:
            if image_paths:
                await self._upload_images(image_paths)
            await self._inject_prompt(job.payload.prompt_text)
            await self._click_send()
            await self._wait_for_thinking_cycle()
            md, text, html = await self._wait_for_final()
        finally:
            await self._cleanup_files(image_paths)
        content = md.strip() or text.strip()
        return {
            "id": f"chatcmpl-{job.job_id[:24]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": job.payload.model or DEFAULT_MODEL,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            "_debug": {"markdown": md, "text": text, "html": html},
        }

    async def _ensure_ready(self) -> None:
        assert self._page is not None
        if not self._page.url.startswith(self.chat_url):
            await self._page.goto(self.chat_url, wait_until="domcontentloaded", timeout=self.timeout_ms)
        await self._wait_for_ready_composer()

    async def _wait_for_ready_composer(self) -> None:
        assert self._page is not None
        deadline = time.monotonic() + 120.0
        last_title = ""
        last_preview = ""
        while time.monotonic() < deadline:
            try:
                last_title = await self._page.title()
            except Exception:
                last_title = ""
            try:
                body_text = await self._page.evaluate(
                    "() => ((document.body && document.body.innerText) ? document.body.innerText : '')"
                )
            except Exception:
                body_text = ""
            last_preview = str(body_text or "")[:220]
            low_title = last_title.lower()
            low_body = str(body_text or "").lower()
            if any(marker in low_title or marker in low_body for marker in CHALLENGE_MARKERS):
                await asyncio.sleep(2.0)
                continue
            if await self._any_visible(TEXTAREA_SELECTORS + EDITABLE_SELECTORS):
                return
            await asyncio.sleep(0.5)
        raise RuntimeError(f"Chat page not ready. title={last_title} preview={last_preview}")

    async def _check_rate_limit(self) -> None:
        assert self._page is not None
        body = str(await self._page.evaluate("() => (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : ''"))
        if any(marker in body for marker in RATE_LIMIT_MARKERS):
            raise RuntimeError("Rate limited/frozen state detected.")

    async def _select_model(self, model_name: str) -> None:
        if not model_name:
            return
        assert self._page is not None
        try:
            picker = self._page.get_by_role("button", name=re.compile("model|gpt|o1|reason", re.I)).first
            await picker.click(timeout=2500)
            await self._page.get_by_text(model_name, exact=False).first.click(timeout=4000)
        except Exception:
            return

    async def _inject_prompt(self, prompt: str) -> None:
        if len(prompt) > PROMPT_CLIPBOARD_THRESHOLD:
            ok = await self._inject_clipboard(prompt)
            if not ok:
                raise RuntimeError("Clipboard injection failed for long prompt.")
            return
        try:
            await self._inject_fill(prompt)
            return
        except RuntimeError:
            pass
        # ChatGPT UI can render composer as contenteditable instead of textarea.
        ok = await self._inject_clipboard(prompt)
        if not ok:
            raise RuntimeError("Prompt input not found.")

    async def _inject_fill(self, prompt: str) -> None:
        assert self._page is not None
        for sel in TEXTAREA_SELECTORS:
            try:
                loc = self._page.locator(f"{sel}:visible").first
                if await loc.count() == 0:
                    continue
                await loc.fill(prompt, timeout=5000)
                return
            except Exception:
                continue
        for sel in EDITABLE_SELECTORS:
            try:
                loc = self._page.locator(f"{sel}:visible").first
                if await loc.count() == 0:
                    continue
                await loc.click(timeout=5000)
                await self._page.keyboard.press("Control+A")
                await self._page.keyboard.type(prompt, delay=0)
                return
            except Exception:
                continue
        title = ""
        url = ""
        preview = ""
        try:
            title = await self._page.title()
            url = self._page.url
            preview = await self._page.evaluate(
                "() => ((document.body && document.body.innerText) ? document.body.innerText : '').slice(0, 180)"
            )
        except Exception:
            pass
        detail = f"Prompt input not found. url={url} title={title} preview={str(preview)}".strip()
        raise RuntimeError(detail)

    async def _inject_clipboard(self, prompt: str) -> bool:
        assert self._page is not None
        script = """
        ({ textareas, editables, text }) => {
          const isVisible = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            return !!cs && cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
          };
          const pick = (arr) => {
            for (const s of arr) {
              const nodes = Array.from(document.querySelectorAll(s));
              for (const el of nodes) {
                if (isVisible(el)) return el;
              }
            }
            return null;
          };
          const t = pick(textareas) || pick(editables);
          if (!t) return false;
          t.focus();
          try {
            const dt = new DataTransfer();
            dt.setData("text/plain", text);
            t.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
          } catch (_) {}
          if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") t.value = text;
          else t.textContent = text;
          t.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, data: text, inputType: "insertFromPaste" }));
          t.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        """
        return bool(
            await self._page.evaluate(
                script,
                {"textareas": TEXTAREA_SELECTORS, "editables": EDITABLE_SELECTORS, "text": prompt},
            )
        )

    async def _click_send(self) -> None:
        assert self._page is not None
        for sel in SEND_BUTTON_SELECTORS:
            try:
                loc = self._page.locator(sel).first
                if await loc.count() == 0:
                    continue
                await loc.click(timeout=5000)
                return
            except Exception:
                continue
        await self._page.keyboard.press("Enter")

    async def _wait_for_thinking_cycle(self) -> None:
        saw = False
        appear_deadline = time.monotonic() + 45.0
        while time.monotonic() < appear_deadline:
            if await self._any_visible(THINKING_SELECTORS):
                saw = True
                break
            await asyncio.sleep(0.25)
        if not saw:
            return
        done_deadline = time.monotonic() + TIMEOUT_SECONDS
        while time.monotonic() < done_deadline:
            if not await self._any_visible(THINKING_SELECTORS):
                return
            await asyncio.sleep(0.35)
        raise PlaywrightTimeoutError("Thinking did not complete in 600s.")

    async def _wait_for_final(self) -> Tuple[str, str, str]:
        stable = 0
        last = ""
        final_md = ""
        final_text = ""
        final_html = ""
        deadline = time.monotonic() + TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            md, text, html = await self._extract_latest()
            candidate = md.strip() or text.strip()
            if candidate and candidate == last and not await self._any_visible(THINKING_SELECTORS):
                stable += 1
            else:
                stable = 0
                last = candidate
            if candidate:
                final_md, final_text, final_html = md, text, html
            if candidate and stable >= 4:
                break
            await asyncio.sleep(0.8)
        if not final_md and not final_text:
            raise PlaywrightTimeoutError("No final response detected in 600s.")
        return final_md, final_text, final_html

    async def _extract_latest(self) -> Tuple[str, str, str]:
        assert self._page is not None
        script = """
        (msgSelectors, mdSelectors) => {
          const nodes = [];
          for (const s of msgSelectors) for (const n of Array.from(document.querySelectorAll(s))) nodes.push(n);
          if (!nodes.length) return { markdown: "", text: "", html: "" };
          const msg = nodes[nodes.length - 1];
          const markdown = [];
          for (const s of mdSelectors) for (const n of Array.from(msg.querySelectorAll(s))) { const t = (n.innerText || "").trim(); if (t) markdown.push(t); }
          const tableToMd = (table) => {
            const rows = Array.from(table.querySelectorAll("tr"));
            if (!rows.length) return "";
            const matrix = rows.map((tr) => Array.from(tr.querySelectorAll("th,td")).map((c) => (c.innerText || "").replace(/\\n+/g, " ").trim()));
            if (!matrix.length) return "";
            const h = matrix[0], b = matrix.slice(1);
            const fmt = (arr) => "| " + arr.map((v) => v || " ").join(" | ") + " |";
            const out = [fmt(h), "| " + h.map(() => "---").join(" | ") + " |"];
            for (const r of b) out.push(fmt(r));
            return out.join("\\n");
          };
          for (const t of Array.from(msg.querySelectorAll("table"))) { const md = tableToMd(t); if (md) markdown.push(md); }
          return { markdown: markdown.join("\\n\\n").trim(), text: (msg.innerText || "").trim(), html: (msg.innerHTML || "").trim() };
        }
        """
        out = await self._page.evaluate(script, ASSISTANT_SELECTORS, MARKDOWN_SELECTORS)
        if not isinstance(out, dict):
            return "", "", ""
        return str(out.get("markdown") or ""), str(out.get("text") or ""), str(out.get("html") or "")

    async def _any_visible(self, selectors: List[str]) -> bool:
        assert self._page is not None
        for sel in selectors:
            try:
                loc = self._page.locator(sel).first
                if await loc.count() > 0 and await loc.is_visible():
                    return True
            except Exception:
                continue
        return False

    async def _upload_images(self, paths: List[str]) -> None:
        assert self._page is not None
        inp = self._page.locator("input[type='file']").first
        if await inp.count() == 0:
            raise RuntimeError("image_url provided but file input not found.")
        await inp.set_input_files(paths)
        for sel in UPLOAD_READY_SELECTORS:
            try:
                await self._page.locator(sel).first.wait_for(state="visible", timeout=10000)
                return
            except Exception:
                continue
        await asyncio.sleep(0.5)

    async def _materialize_images(self, image_urls: List[str]) -> List[str]:
        return [await asyncio.to_thread(self._materialize_one, url) for url in image_urls]

    def _materialize_one(self, image_url: str) -> str:
        if image_url.startswith("data:"):
            header, encoded = image_url.split(",", 1)
            mt = re.match(r"data:(image/[a-zA-Z0-9.+-]+);base64", header)
            if not mt:
                raise RuntimeError("Unsupported data URL image payload.")
            mime = mt.group(1).lower()
            ext = ".png" if mime not in {"image/jpeg", "image/webp"} else (".jpg" if mime == "image/jpeg" else ".webp")
            raw = base64.b64decode(encoded, validate=False)
        else:
            req = urllib.request.Request(image_url, headers={"User-Agent": "cortex-sidecar/1.0"}, method="GET")
            with urllib.request.urlopen(req, timeout=60) as rsp:
                raw = rsp.read()
                ctype = (rsp.headers.get("Content-Type") or "").lower()
            ext = ".jpg" if "jpeg" in ctype else (".webp" if "webp" in ctype else ".png")
        fd, path = tempfile.mkstemp(prefix="cortex-upload-", suffix=ext)
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        return path

    async def _cleanup_files(self, paths: List[str]) -> None:
        await asyncio.to_thread(self._cleanup_files_sync, paths)

    def _cleanup_files_sync(self, paths: List[str]) -> None:
        for p in paths:
            try:
                os.remove(p)
            except Exception:
                pass

    async def _diagnostics(self) -> Dict[str, Any]:
        if self._page is None:
            return {"ready": False, "error": "No active page/context."}
        try:
            selectors = list(dict.fromkeys(TEXTAREA_SELECTORS + EDITABLE_SELECTORS + SEND_BUTTON_SELECTORS))
            counts: Dict[str, Dict[str, int]] = {}
            for sel in selectors:
                all_count = 0
                visible_count = 0
                try:
                    loc = self._page.locator(sel)
                    all_count = await loc.count()
                    visible_count = await self._page.locator(f"{sel}:visible").count()
                except Exception:
                    pass
                counts[sel] = {"all": int(all_count), "visible": int(visible_count)}

            body_preview = await self._page.evaluate(
                "() => ((document.body && document.body.innerText) ? document.body.innerText : '').slice(0, 1200)"
            )
            return {
                "ready": True,
                "url": self._page.url,
                "title": await self._page.title(),
                "selectors": counts,
                "body_preview": str(body_preview or ""),
            }
        except Exception as exc:
            return {"ready": False, "error": f"Diagnostics failed: {exc}"}


def parse_openai_payload(payload: Dict[str, Any]) -> Optional[JobPayload]:
    messages = payload.get("messages")
    if not isinstance(messages, list):
        return None
    model = str(payload.get("model") or DEFAULT_MODEL)
    texts: List[str] = []
    image_urls: List[str] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        if str(m.get("role") or "").lower() not in {"system", "user"}:
            continue
        content = m.get("content")
        if isinstance(content, str):
            texts.append(content)
            continue
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                ptype = str(part.get("type") or "").lower()
                if ptype == "text" and isinstance(part.get("text"), str):
                    texts.append(part["text"])
                elif ptype == "image_url":
                    img = part.get("image_url")
                    url = img.get("url") if isinstance(img, dict) else img
                    if isinstance(url, str) and url.strip():
                        image_urls.append(url.strip())
    prompt = "\n\n".join(t for t in texts if t).strip()
    if not prompt and not image_urls:
        return None
    return JobPayload(model=model, prompt_text=prompt, image_urls=image_urls)


def build_model_list(expose_reasoning_models: bool) -> List[str]:
    base = ["gpt-5", "gpt-5.1", "gpt-5.2", "gpt-5-codex", "gpt-5.1-codex", "gpt-5.2-codex", "o1"]
    if not expose_reasoning_models:
        return base
    return base + [
        "gpt-5-high", "gpt-5-medium", "gpt-5-low", "gpt-5-minimal",
        "gpt-5-codex-high", "gpt-5-codex-medium", "gpt-5-codex-low",
        "gpt-5.1-high", "gpt-5.1-medium", "gpt-5.1-low",
        "gpt-5.2-high", "gpt-5.2-medium", "gpt-5.2-low", "gpt-5.2-xhigh",
        "gpt-5.1-codex-max", "gpt-5.1-codex-max-high", "gpt-5.1-codex-max-xhigh",
    ]


def create_app(
    worker: PlaywrightWorker,
    *,
    expose_reasoning_models: bool,
    traffic_max_entries: int,
    log_health_traffic: bool = False,
) -> Flask:
    app = Flask(__name__)
    traffic = TrafficLog(traffic_max_entries)

    @app.before_request
    def _before() -> None:
        if request.path.startswith("/debug/traffic"):
            return None
        if request.path == "/health" and not log_health_traffic:
            return None
        req_id = uuid.uuid4().hex
        g.req_id = req_id
        g.req_started = time.perf_counter()
        payload = None
        raw = request.get_data(cache=True, as_text=True) or ""
        if raw:
            try:
                payload = json.loads(raw)
            except Exception:
                payload = raw[:5000]
        traffic.add_request(
            {
                "request_id": req_id,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "+00:00",
                "method": request.method,
                "path": request.path,
                "query": request.query_string.decode("utf-8", errors="ignore") if request.query_string else "",
                "headers": _safe_headers(request.headers),
                "payload": payload,
                "response": None,
            }
        )
        return None

    @app.after_request
    def _after(resp):
        resp.headers.setdefault("Access-Control-Allow-Origin", "*")
        resp.headers.setdefault("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept")
        resp.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
        if request.path.startswith("/debug/traffic"):
            return resp
        if request.path == "/health" and not log_health_traffic:
            return resp
        req_id = getattr(g, "req_id", "")
        if not req_id:
            return resp
        dur = None
        if isinstance(getattr(g, "req_started", None), (int, float)):
            dur = round((time.perf_counter() - g.req_started) * 1000.0, 2)
        payload = None
        if not resp.is_streamed:
            payload = resp.get_json(silent=True)
            if payload is None:
                try:
                    payload = resp.get_data(as_text=True)
                except Exception:
                    payload = None
        traffic.add_response(req_id, {"status_code": int(resp.status_code), "duration_ms": dur, "is_streamed": bool(resp.is_streamed), "payload": payload})
        return resp

    @app.get("/")
    @app.get("/health")
    def health() -> Response:
        return jsonify({"status": "ok"})

    @app.get("/v1/models")
    def models() -> Response:
        data = [{"id": m, "object": "model", "owned_by": "owner"} for m in build_model_list(expose_reasoning_models)]
        return jsonify({"object": "list", "data": data})

    @app.get("/debug/traffic")
    def get_traffic() -> Response:
        limit = request.args.get("limit", default=100, type=int)
        rows = traffic.recent(limit)
        return jsonify({"count": len(rows), "data": rows})

    @app.delete("/debug/traffic")
    def clear_traffic() -> Response:
        traffic.clear()
        return jsonify({"ok": True})

    @app.get("/debug/worker-state")
    def worker_state() -> Response:
        try:
            state = worker.diagnostics()
            return jsonify(state), 200
        except Exception as exc:
            return jsonify({"ready": False, "error": str(exc)}), 500

    @app.route("/v1/chat/completions", methods=["POST", "OPTIONS"])
    def chat_completions() -> Response:
        if request.method == "OPTIONS":
            return make_response("", 204)
        try:
            payload = request.get_json(force=True, silent=False) or {}
        except Exception:
            return jsonify({"error": {"message": "Invalid JSON body"}}), 400
        parsed = parse_openai_payload(payload)
        if parsed is None:
            return jsonify({"error": {"message": "Request must include user/system text or image_url payload."}}), 400
        fut = worker.submit(parsed)
        try:
            completion = fut.result(timeout=TIMEOUT_SECONDS + 15.0)
        except concurrent.futures.TimeoutError:
            return jsonify({"error": {"message": "Timed out waiting for worker result."}}), 504
        except PlaywrightTimeoutError as exc:
            return jsonify({"error": {"message": f"Playwright timeout: {exc}"}}), 504
        except Exception as exc:
            return jsonify({"error": {"message": f"Worker failure: {exc}"}}), 502
        completion.pop("_debug", None)
        return jsonify(completion), 200

    return app


async def run_playwright_login(user_data_dir: str, chat_url: str, headed: bool) -> int:
    os.makedirs(user_data_dir, exist_ok=True)
    print("Opening persistent browser context for manual login.")
    print("Sign in to ChatGPT, then press Ctrl+C here.")
    pw = await async_playwright().start()
    ctx = await pw.chromium.launch_persistent_context(
        user_data_dir,
        headless=not headed,
        viewport={"width": 1500, "height": 980},
        args=["--disable-blink-features=AutomationControlled"],
    )
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    await page.goto(chat_url, wait_until="domcontentloaded", timeout=int(TIMEOUT_SECONDS * 1000))
    try:
        while True:
            await asyncio.sleep(1.0)
    except KeyboardInterrupt:
        pass
    await ctx.close()
    await pw.stop()
    return 0


def run_legacy_login(no_browser: bool, verbose: bool) -> int:
    cmd = [sys.executable, "-m", "chatmock.cli", "login"]
    if no_browser:
        cmd.append("--no-browser")
    if verbose:
        cmd.append("--verbose")
    return subprocess.call(cmd)


def run_legacy_info(json_output: bool) -> int:
    cmd = [sys.executable, "-m", "chatmock.cli", "info"]
    if json_output:
        cmd.append("--json")
    return subprocess.call(cmd)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cortex Sidecar")
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="Run OpenAI-compatible Cortex Sidecar")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--chat-url", default=os.getenv("CHATMOCK_CHAT_URL", CHAT_URL_DEFAULT))
    serve.add_argument("--user-data-dir", default=os.getenv("CHATMOCK_USER_DATA_DIR") or os.getenv("CHATGPT_LOCAL_HOME") or "./auth")
    serve.add_argument("--headed", action=argparse.BooleanOptionalAction, default=_bool_env("CHATGPT_LOCAL_HEADED", False))
    serve.add_argument("--request-timeout", type=float, default=TIMEOUT_SECONDS)
    serve.add_argument("--upstream-timeout", type=float, default=TIMEOUT_SECONDS)
    serve.add_argument("--request-queue", action=argparse.BooleanOptionalAction, default=True)
    serve.add_argument("--aggressive-mode", action=argparse.BooleanOptionalAction, default=True)
    serve.add_argument("--block-resources", action=argparse.BooleanOptionalAction, default=True)
    serve.add_argument("--expose-reasoning-models", action="store_true", default=_bool_env("CHATGPT_LOCAL_EXPOSE_REASONING_MODELS", True))
    serve.add_argument("--traffic-max-entries", type=int, default=int(os.getenv("CHATGPT_LOCAL_TRAFFIC_MAX_ENTRIES", "400")))
    serve.add_argument("--log-health-traffic", action=argparse.BooleanOptionalAction, default=_bool_env("CHATGPT_LOCAL_LOG_HEALTH", False))

    login = sub.add_parser("login", help="Login for persistent browser profile")
    login.add_argument("--user-data-dir", default=os.getenv("CHATMOCK_USER_DATA_DIR") or os.getenv("CHATGPT_LOCAL_HOME") or "./auth")
    login.add_argument("--chat-url", default=os.getenv("CHATMOCK_CHAT_URL", CHAT_URL_DEFAULT))
    login.add_argument("--headed", action=argparse.BooleanOptionalAction, default=True)
    login.add_argument("--no-browser", action="store_true")
    login.add_argument("--verbose", action="store_true")

    info = sub.add_parser("info", help="Legacy auth info")
    info.add_argument("--json", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.command == "login":
        if args.no_browser:
            raise SystemExit(run_legacy_login(no_browser=True, verbose=bool(args.verbose)))
        raise SystemExit(asyncio.run(run_playwright_login(args.user_data_dir, args.chat_url, headed=bool(args.headed))))
    if args.command == "info":
        raise SystemExit(run_legacy_info(json_output=bool(args.json)))
    if args.command == "serve":
        worker = PlaywrightWorker(user_data_dir=args.user_data_dir, chat_url=args.chat_url, headed=bool(args.headed))
        worker.start()
        app = create_app(
            worker,
            expose_reasoning_models=bool(args.expose_reasoning_models),
            traffic_max_entries=max(1, int(args.traffic_max_entries)),
            log_health_traffic=bool(args.log_health_traffic),
        )
        try:
            app.run(host=args.host, port=int(args.port), debug=False, use_reloader=False, threaded=True)
        finally:
            worker.stop()
        raise SystemExit(0)
    raise SystemExit(1)


if __name__ == "__main__":
    main()
