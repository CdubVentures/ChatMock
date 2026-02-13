from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Dict


@dataclass
class RequestLease:
    _gate: "FifoRequestGate"
    _released: bool = False

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        self._gate._release()


class FifoRequestGate:
    """Thread-safe FIFO gate that allows one active request at a time."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = bool(enabled)
        self._condition = threading.Condition()
        self._next_ticket = 0
        self._serving_ticket = 0
        self._active = False
        self._waiting = 0

    def acquire(self) -> RequestLease:
        if not self.enabled:
            return RequestLease(self)

        with self._condition:
            my_ticket = self._next_ticket
            self._next_ticket += 1
            self._waiting += 1
            while my_ticket != self._serving_ticket or self._active:
                self._condition.wait()
            self._waiting -= 1
            self._active = True
            return RequestLease(self)

    def _release(self) -> None:
        if not self.enabled:
            return
        with self._condition:
            if not self._active:
                return
            self._active = False
            self._serving_ticket += 1
            self._condition.notify_all()

    def snapshot(self) -> Dict[str, int | bool]:
        with self._condition:
            return {
                "enabled": self.enabled,
                "active": self._active,
                "waiting": self._waiting,
                "next_ticket": self._next_ticket,
                "serving_ticket": self._serving_ticket,
            }
