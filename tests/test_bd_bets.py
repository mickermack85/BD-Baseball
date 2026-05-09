"""Tests for BD Bets feed ingestion, validation, and show-generator integration.

The BD Bets feed is editorial/show-prep data sourced from Matt's BD Bets
project, not a sportsbook integration. These tests cover:

- normalize_pick / normalize_feed in scripts/bd_bets.py
- resolve_feed via local path and via fetch (URL stub)
- build_snapshot integration: bd_bets section absence/presence/source_error
- validator: shape rules + active-pick model_note requirement
- show_generator BD Bets segment + livestream package inclusion
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import bd_bets  # type: ignore  # noqa: E402
import build_snapshot as b  # type: ignore  # noqa: E402
import validate_snapshot as v  # type: ignore  # noqa: E402

FIXTURE = ROOT / "fixtures" / "sample_bd_bets.json"
GEN = ROOT / "show_generator.js"


def _node() -> str | None:
    return shutil.which("node")


def _good_pick() -> dict:
    return {
        "away_team": "Texas Rangers",
        "home_team": "Detroit Tigers",
        "market": "total",
        "pick": "Under 8.5",
        "line": "8.5",
        "odds": "-110",
        "confidence": "high",
        "edge": "+6.1%",
        "model_note": "Two contact-managers; wind in from center.",
        "status": "open",
    }


class NormalizeTests(unittest.TestCase):
    def test_normalize_pick_drops_when_required_missing(self) -> None:
        bad = dict(_good_pick())
        bad.pop("market")
        self.assertIsNone(bd_bets.normalize_pick(bad))

    def test_normalize_pick_defaults_status_open(self) -> None:
        p = dict(_good_pick())
        p.pop("status")
        out = bd_bets.normalize_pick(p)
        self.assertIsNotNone(out)
        self.assertEqual(out["status"], "open")

    def test_normalize_pick_invalid_status_falls_back_to_open(self) -> None:
        p = dict(_good_pick())
        p["status"] = "weird"
        out = bd_bets.normalize_pick(p)
        self.assertEqual(out["status"], "open")

    def test_normalize_confidence_numeric(self) -> None:
        p = dict(_good_pick())
        p["confidence"] = 0.8
        out = bd_bets.normalize_pick(p)
        self.assertEqual(out["confidence"], "high")
        p["confidence"] = 0.5
        self.assertEqual(bd_bets.normalize_pick(p)["confidence"], "medium")
        p["confidence"] = 0.1
        self.assertEqual(bd_bets.normalize_pick(p)["confidence"], "low")

    def test_normalize_feed_drops_invalid_picks(self) -> None:
        feed = {
            "generated_at": "2026-05-01T13:30:00Z",
            "slate_date": "2026-05-01",
            "sport": "MLB",
            "picks": [_good_pick(), {"away_team": "x"}],
        }
        out = bd_bets.normalize_feed(feed)
        self.assertEqual(len(out["picks"]), 1)
        self.assertEqual(out["dropped_picks"], 1)
        self.assertEqual(out["source_status"], "verified")

    def test_normalize_feed_empty_marks_unverified(self) -> None:
        out = bd_bets.normalize_feed({"sport": "MLB", "picks": []})
        self.assertEqual(out["source_status"], "unverified")

    def test_normalize_feed_non_dict_is_source_error(self) -> None:
        out = bd_bets.normalize_feed(["picks"])
        self.assertEqual(out["source_status"], "source_error")
        self.assertIn("source_error", out)


class ResolveFeedTests(unittest.TestCase):
    def test_resolve_from_path(self) -> None:
        section = bd_bets.resolve_feed(path=str(FIXTURE), env={})
        self.assertIsNotNone(section)
        self.assertEqual(section["source_status"], "verified")
        self.assertEqual(len(section["picks"]), 2)
        self.assertEqual(section["feed_path"], str(FIXTURE))

    def test_resolve_from_path_missing(self) -> None:
        section = bd_bets.resolve_feed(path="/nonexistent/feed.json", env={})
        self.assertEqual(section["source_status"], "source_error")
        self.assertIn("file_not_found", section["source_error"])

    def test_resolve_from_url(self) -> None:
        feed = json.loads(FIXTURE.read_text(encoding="utf-8"))
        calls = {}

        def fake_fetch(url: str):
            calls["url"] = url
            return feed, None

        section = bd_bets.resolve_feed(
            url="https://example.com/bd-bets.json",
            fetch=fake_fetch,
            env={},
        )
        self.assertEqual(section["source_status"], "verified")
        self.assertEqual(calls["url"], "https://example.com/bd-bets.json")
        self.assertEqual(section["feed_url"], "https://example.com/bd-bets.json")

    def test_resolve_from_url_error(self) -> None:
        def fake_fetch(url: str):
            return None, "http_error: 503 Service Unavailable"

        section = bd_bets.resolve_feed(
            url="https://example.com/bd-bets.json",
            fetch=fake_fetch,
            env={},
        )
        self.assertEqual(section["source_status"], "source_error")
        self.assertIn("503", section["source_error"])

    def test_resolve_returns_none_when_unconfigured(self) -> None:
        self.assertIsNone(bd_bets.resolve_feed(env={}))

    def test_env_path_picked_up(self) -> None:
        section = bd_bets.resolve_feed(env={"BD_BETS_PATH": str(FIXTURE)})
        self.assertIsNotNone(section)
        self.assertEqual(section["source_status"], "verified")


def _standings_payload() -> dict:
    return {"records": [{"division": {"name": "AL West"}, "teamRecords": [
        {"team": {"id": 133, "name": "Athletics"}, "wins": 12, "losses": 18,
         "winningPercentage": ".400", "gamesBack": "5.0"}]}]}


def _schedule_payload() -> dict:
    return {"dates": [{"games": [{"gameDate": "2026-05-01T23:10:00Z",
        "status": {"detailedState": "Scheduled"}, "venue": {"name": "Stadium"},
        "teams": {
            "away": {"team": {"id": 119, "name": "Dodgers"},
                     "probablePitcher": {"fullName": "P1"}},
            "home": {"team": {"id": 133, "name": "Athletics"},
                     "probablePitcher": {"fullName": "P2"}}}}]}]}


def _transactions_payload() -> dict:
    return {"transactions": [{"date": "2026-04-30", "description": "tx desc"}]}


_NEWS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
  <item><title>h1</title><link>https://x/1</link><pubDate>Mon, 04 May 2026 12:00:00 GMT</pubDate></item>
</channel></rss>"""


class BuilderIntegrationTests(unittest.TestCase):
    """Builder ingestion of the BD Bets feed via path argument."""

    def _fake_fetch(self):
        std = _standings_payload()
        sched = _schedule_payload()
        tx = _transactions_payload()

        def fetch(url: str):
            if "rss.xml" in url or "espn.com/espn/rss/mlb/news" in url:
                return _NEWS_XML, None
            if "standings" in url:
                return std, None
            if "schedule" in url:
                return sched, None
            if "transactions" in url:
                return tx, None
            raise AssertionError(f"Unexpected test URL: {url}")

        return fetch

    def test_builder_omits_bd_bets_when_unconfigured(self) -> None:
        # Run the builder with no BD Bets configuration (and an empty env);
        # the snapshot must not include a bd_bets section.
        env_save = {}
        for k in ("BD_BETS_PATH", "BD_BETS_URL"):
            if k in os.environ:
                env_save[k] = os.environ.pop(k)
        try:
            snap = b.build_snapshot(fetch=self._fake_fetch())
        finally:
            os.environ.update(env_save)
        self.assertNotIn("bd_bets", snap)
        # source_status should NOT have a bd_bets entry either.
        self.assertNotIn("bd_bets", snap["source_status"])

    def test_builder_includes_bd_bets_when_path_provided(self) -> None:
        snap = b.build_snapshot(
            fetch=self._fake_fetch(),
            bd_bets_path=str(FIXTURE),
        )
        self.assertIn("bd_bets", snap)
        self.assertEqual(snap["bd_bets"]["source_status"], "verified")
        self.assertEqual(len(snap["bd_bets"]["picks"]), 2)
        self.assertEqual(snap["source_status"]["bd_bets"], "verified")

    def test_builder_handles_missing_bd_bets_file(self) -> None:
        snap = b.build_snapshot(
            fetch=self._fake_fetch(),
            bd_bets_path="/nonexistent/feed.json",
        )
        self.assertEqual(snap["bd_bets"]["source_status"], "source_error")
        self.assertIn("source_error", snap["bd_bets"])
        # Builder must still produce a normal snapshot.
        self.assertIn("league", snap)
        self.assertIn("teams", snap)


def _make_valid_snapshot_with_bd_bets(picks: list[dict]) -> dict:
    """Minimal snapshot suitable for validator tests."""
    return {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "schema_version": "3.2",
        "sources": {},
        "source_status": {
            "league_standings": "verified",
            "league_schedule": "verified",
            "league_transactions": "verified",
            "athletics_standings": "verified",
            "rockies_standings": "verified",
            "tigers_standings": "verified",
        },
        "league": {
            "verified_notes": ["Standings: ..."],
            "unverified_notes": [],
            "transactions": [],
            "watch": [],
            "debug": {},
        },
        "teams": {
            t: {
                "verified_notes": ["Standings: row"],
                "unverified_notes": [],
                "source_status": {f"{t}_standings": "verified"},
                "debug": {},
            }
            for t in ("athletics", "rockies", "tigers")
        },
        "debug": {"source_health": {}},
        "bd_bets": {
            "generated_at": "2026-05-01T13:30:00Z",
            "slate_date": "2026-05-01",
            "sport": "MLB",
            "source": "bd_bets",
            "picks": picks,
            "insights": [],
            "source_status": "verified" if picks else "unverified",
        },
    }


class ValidatorTests(unittest.TestCase):
    def test_valid_bd_bets_passes(self) -> None:
        snap = _make_valid_snapshot_with_bd_bets([_good_pick()])
        self.assertEqual(v.validate(snap), [])

    def test_blank_model_note_for_active_pick_fails(self) -> None:
        bad = dict(_good_pick())
        bad["model_note"] = "  "
        snap = _make_valid_snapshot_with_bd_bets([bad])
        problems = v.validate(snap)
        self.assertTrue(any("model_note" in p for p in problems), problems)

    def test_blank_model_note_for_settled_pick_ok(self) -> None:
        # Settled (win/loss) picks don't require a model_note.
        bad = dict(_good_pick())
        bad["model_note"] = ""
        bad["status"] = "win"
        snap = _make_valid_snapshot_with_bd_bets([bad])
        self.assertEqual(v.validate(snap), [])

    def test_invalid_status_flagged(self) -> None:
        bad = dict(_good_pick())
        bad["status"] = "weird"
        snap = _make_valid_snapshot_with_bd_bets([bad])
        problems = v.validate(snap)
        self.assertTrue(any("status invalid" in p for p in problems), problems)

    def test_non_mlb_sport_flagged(self) -> None:
        snap = _make_valid_snapshot_with_bd_bets([_good_pick()])
        snap["bd_bets"]["sport"] = "NFL"
        problems = v.validate(snap)
        self.assertTrue(any("sport must be 'MLB'" in p for p in problems), problems)

    def test_missing_required_pick_field_flagged(self) -> None:
        bad = dict(_good_pick())
        bad["pick"] = ""
        snap = _make_valid_snapshot_with_bd_bets([bad])
        problems = v.validate(snap)
        self.assertTrue(any("pick" in p for p in problems), problems)

    def test_source_error_section_skips_shape_checks(self) -> None:
        snap = _make_valid_snapshot_with_bd_bets([])
        snap["bd_bets"] = {
            "generated_at": "",
            "slate_date": "",
            "sport": "MLB",
            "picks": [],
            "insights": [],
            "source_status": "source_error",
            "source_error": "feed_not_found",
        }
        # Only the source_status itself is validated; missing fields are ok.
        self.assertEqual(v.validate(snap), [])

    def test_snapshot_without_bd_bets_section_passes(self) -> None:
        snap = _make_valid_snapshot_with_bd_bets([])
        snap.pop("bd_bets")
        self.assertEqual(v.validate(snap), [])


@unittest.skipIf(_node() is None, "node not available")
class ShowGeneratorTests(unittest.TestCase):
    def _generate(self, snapshot: dict, options: dict) -> dict:
        script = (
            "const G = require('./show_generator.js');"
            "const snap = JSON.parse(process.env.SNAP);"
            "const opts = JSON.parse(process.env.OPTS);"
            "const r = G.generateRundown(snap, opts);"
            "const pkg = G.generateLivestreamPackage(snap, r, opts);"
            "process.stdout.write(JSON.stringify({rundown: r, "
            "host: G.renderTeleprompter(r, snap), "
            "longDesc: pkg.longDescription, "
            "completePkg: G.renderCompletePackageMarkdown(snap, r, pkg)}));"
        )
        env = os.environ.copy()
        env["SNAP"] = json.dumps(snapshot)
        env["OPTS"] = json.dumps(options)
        res = subprocess.run(
            ["node", "-e", script],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=20,
            env=env,
        )
        if res.returncode != 0:
            raise AssertionError(
                "node failed:\nSTDOUT:\n" + res.stdout + "\nSTDERR:\n" + res.stderr
            )
        return json.loads(res.stdout)

    def _snapshot_with_bets(self) -> dict:
        snap = json.loads((ROOT / "data" / "latest.json").read_text(encoding="utf-8"))
        feed = json.loads(FIXTURE.read_text(encoding="utf-8"))
        snap["bd_bets"] = {
            "generated_at": feed["generated_at"],
            "slate_date": feed["slate_date"],
            "sport": "MLB",
            "source": "bd_bets",
            "picks": feed["picks"],
            "insights": feed["insights"],
            "source_status": "verified",
        }
        snap.setdefault("source_status", {})["bd_bets"] = "verified"
        return snap

    def test_bd_bets_segment_present_when_picks_exist(self) -> None:
        snap = self._snapshot_with_bets()
        out = self._generate(snap, {"preset": "standard", "teams": ["athletics"]})
        ids = [s["id"] for s in out["rundown"]["segments"]]
        self.assertIn("bd_bets", ids)
        # Must come before closer.
        self.assertLess(ids.index("bd_bets"), ids.index("closer"))

    def test_bd_bets_segment_absent_when_no_picks(self) -> None:
        snap = json.loads((ROOT / "data" / "latest.json").read_text(encoding="utf-8"))
        out = self._generate(snap, {"preset": "standard", "teams": ["athletics"]})
        ids = [s["id"] for s in out["rundown"]["segments"]]
        self.assertNotIn("bd_bets", ids)

    def test_host_script_includes_pick_and_model_note(self) -> None:
        snap = self._snapshot_with_bets()
        out = self._generate(snap, {"preset": "standard", "teams": ["athletics"]})
        self.assertIn("BD Bets", out["host"])
        self.assertIn("Under 8.5", out["host"])
        self.assertIn("Model note:", out["host"])
        # Editorial framing — never wagering instructions.
        self.assertNotIn("place a bet", out["host"].lower())

    def test_livestream_long_description_includes_bd_bets(self) -> None:
        snap = self._snapshot_with_bets()
        out = self._generate(snap, {"preset": "standard", "teams": ["athletics"]})
        self.assertIn("BD Bets", out["longDesc"])
        self.assertIn("Under 8.5", out["longDesc"])

    def test_complete_package_includes_bd_bets(self) -> None:
        snap = self._snapshot_with_bets()
        out = self._generate(snap, {"preset": "standard", "teams": ["athletics"]})
        self.assertIn("BD Bets", out["completePkg"])
        self.assertIn("Under 8.5", out["completePkg"])

    def test_empty_state_message_when_no_picks(self) -> None:
        # If a bd_bets section exists with no picks, segment isn't added
        # (so the show stays honest about its time budget). The compact UI
        # card and the text rendering surface "No BD Bets picks…" instead.
        snap = json.loads((ROOT / "data" / "latest.json").read_text(encoding="utf-8"))
        snap["bd_bets"] = {
            "generated_at": "",
            "slate_date": "",
            "sport": "MLB",
            "picks": [],
            "insights": [],
            "source_status": "unverified",
        }
        out = self._generate(snap, {"preset": "quick", "teams": []})
        ids = [s["id"] for s in out["rundown"]["segments"]]
        self.assertNotIn("bd_bets", ids)


class StaticAppIntegrationTests(unittest.TestCase):
    """Sanity-check that the BD Bets UI hooks are wired without running a browser."""

    def test_index_html_has_bd_bets_today_card(self) -> None:
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="bdBetsToday"', html)
        self.assertIn('id="bdBetsTodayCard"', html)

    def test_app_js_renders_bd_bets_today(self) -> None:
        text = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn("renderBdBetsToday", text)
        self.assertIn("bd_bets", text)
        # Safety: still no innerHTML interpolation introduced.
        self.assertNotIn(".innerHTML", text)

    def test_show_generator_exposes_bd_bets_helpers(self) -> None:
        text = (ROOT / "show_generator.js").read_text(encoding="utf-8")
        for name in [
            "buildBdBetsSegment",
            "getBdBetsPicks",
            "formatBdBetsLine",
        ]:
            self.assertIn(name, text)


if __name__ == "__main__":
    unittest.main()
