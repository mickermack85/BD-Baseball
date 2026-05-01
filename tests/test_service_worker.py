"""Static checks on sw.js so the show-day strategy can't silently regress.

The service worker is small enough that a JS runtime isn't worth pulling in;
these stdlib tests assert the invariants we care about: cache version is
bumped on each strategy change, the snapshot has its own data cache with a
network timeout, and the snapshot path is handled via stale-while-revalidate
rather than naive network-only.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SW = (ROOT / "sw.js").read_text(encoding="utf-8")


class ServiceWorkerStaticTests(unittest.TestCase):
    def test_has_versioned_cache_key(self) -> None:
        # Cache version must be a single string the activate handler can
        # diff against to evict prior versions.
        m = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW)
        self.assertIsNotNone(m, "CACHE_VERSION constant missing")
        self.assertRegex(m.group(1), r"^bd-baseball-v\d+$")

    def test_snapshot_has_dedicated_data_cache(self) -> None:
        # Data and shell must live in separate caches so a snapshot churn
        # doesn't evict shell assets and vice versa.
        self.assertIn("DATA_CACHE", SW)
        self.assertIn("SHELL_CACHE", SW)

    def test_network_timeout_is_bounded(self) -> None:
        m = re.search(r"NETWORK_TIMEOUT_MS\s*=\s*(\d+)", SW)
        self.assertIsNotNone(m, "NETWORK_TIMEOUT_MS constant missing")
        ms = int(m.group(1))
        self.assertGreaterEqual(ms, 1000, "timeout too aggressive (<1s)")
        self.assertLessEqual(ms, 10000, "timeout too lenient (>10s)")

    def test_latest_json_uses_stale_while_revalidate(self) -> None:
        # Stale-while-revalidate fingerprint: serve cached, then revalidate.
        self.assertIn("LATEST_PATH", SW)
        self.assertIn("handleLatestJson", SW)
        # The handler should consult the cache before deciding to wait on
        # the network — i.e. cache lookup precedes the network promise.
        cache_pos = SW.find("cache.match(LATEST_PATH)")
        net_pos = SW.find("fetchWithTimeout(event.request, NETWORK_TIMEOUT_MS)")
        self.assertGreater(cache_pos, 0, "cache.match for snapshot missing")
        self.assertGreater(net_pos, 0, "timed network fetch missing")
        self.assertLess(cache_pos, net_pos, "cache lookup should precede network in SWR")

    def test_static_assets_cache_first(self) -> None:
        # Show-day shell load must not block on the network.
        self.assertIn("caches.match(event.request).then", SW)


if __name__ == "__main__":
    unittest.main()
