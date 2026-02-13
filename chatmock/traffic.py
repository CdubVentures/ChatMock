from __future__ import annotations

import threading
from collections import deque
from typing import Any, Deque, Dict, List


class TrafficLog:
    """Thread-safe in-memory ring buffer for request/response traffic."""

    def __init__(self, max_entries: int = 300) -> None:
        self.max_entries = max(1, int(max_entries))
        self._entries: Deque[Dict[str, Any]] = deque()
        self._by_id: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def record_request(self, entry: Dict[str, Any]) -> None:
        request_id = str(entry.get("request_id") or "")
        if not request_id:
            return
        with self._lock:
            self._entries.append(entry)
            self._by_id[request_id] = entry
            while len(self._entries) > self.max_entries:
                old = self._entries.popleft()
                old_id = str(old.get("request_id") or "")
                if old_id:
                    self._by_id.pop(old_id, None)

    def record_response(self, request_id: str, response_meta: Dict[str, Any]) -> None:
        if not request_id:
            return
        with self._lock:
            entry = self._by_id.get(request_id)
            if not isinstance(entry, dict):
                return
            entry["response"] = response_meta

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._by_id.clear()

    def recent(self, limit: int = 100) -> List[Dict[str, Any]]:
        capped = max(1, min(int(limit), self.max_entries))
        with self._lock:
            return list(self._entries)[-capped:]
