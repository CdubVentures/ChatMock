import threading
import time

from chatmock.request_queue import FifoRequestGate


def test_fifo_request_gate_processes_waiters_in_submission_order():
    gate = FifoRequestGate(enabled=True)
    first_lease = gate.acquire()
    observed = []
    threads = []

    def worker(index):
        lease = gate.acquire()
        observed.append(index)
        time.sleep(0.01)
        lease.release()

    for i in range(10):
        t = threading.Thread(target=worker, args=(i,))
        threads.append(t)
        t.start()
        time.sleep(0.003)

    first_lease.release()

    for t in threads:
        t.join(timeout=2)
        assert not t.is_alive()

    assert observed == list(range(10))
    snapshot = gate.snapshot()
    assert snapshot["active"] is False
    assert snapshot["waiting"] == 0
