from __future__ import annotations

import re
from typing import Any, Dict, List


_STRIP_TAGS_RE = re.compile(r"<(script|style|svg)\b[^>]*>.*?</\1>", flags=re.IGNORECASE | re.DOTALL)
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", flags=re.DOTALL)
_MULTI_BLANK_LINES_RE = re.compile(r"\n{3,}")


def minify_dom_text(text: str) -> str:
    """Minify raw HTML-ish text while preserving meaningful structure."""
    if not isinstance(text, str) or not text:
        return text

    if "<" not in text or ">" not in text:
        return text

    cleaned = _STRIP_TAGS_RE.sub("", text)
    cleaned = _HTML_COMMENT_RE.sub("", cleaned)
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = _MULTI_BLANK_LINES_RE.sub("\n\n", cleaned)
    return cleaned.strip()


def prepare_messages_for_aggressive_mode(
    messages: List[Dict[str, Any]],
    *,
    large_text_threshold: int = 1000,
) -> List[Dict[str, Any]]:
    if not isinstance(messages, list):
        return messages

    normalized: List[Dict[str, Any]] = []
    for message in messages:
        if not isinstance(message, dict):
            normalized.append(message)
            continue

        cloned = dict(message)
        content = cloned.get("content")

        if isinstance(content, str) and len(content) > large_text_threshold:
            cloned["content"] = minify_dom_text(content)
        elif isinstance(content, list):
            parts: List[Any] = []
            for part in content:
                if not isinstance(part, dict):
                    parts.append(part)
                    continue
                part_cloned = dict(part)
                ptype = str(part_cloned.get("type") or "").strip().lower()
                if ptype == "text":
                    ptext = part_cloned.get("text")
                    if isinstance(ptext, str) and len(ptext) > large_text_threshold:
                        part_cloned["text"] = minify_dom_text(ptext)
                parts.append(part_cloned)
            cloned["content"] = parts

        normalized.append(cloned)

    return normalized
