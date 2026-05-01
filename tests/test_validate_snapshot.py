"""Tests for scripts/validate_snapshot.py."""
from __future__ import annotations

import copy
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import validate_snapshot as v  # type: ignore  # noqa: E402


def _fresh_now() -> datetime:
    return datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)


def _good_snapshot() -> dict:
    now = _fresh_now()
    return {
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "schema_version": "3.0",
        "sources": {"league_standings": "https://x"},
        "source_status": {
            "league_standings": "verified",
            "league_schedule": "verified",
            "league_transactions": "verified",
            "athletics_standings": "verified",
            "rockies_schedule": "unverified",
            "tigers_transactions": "verified",
        },
        "league": {
            "headline": "x",
            "verified_notes": ["Standings: ..."],
            "unverified_notes": [],
            "stories": [],
            "watch": [],
            "transactions": [],
            "debug": {},
        },
        "teams": {
            "athletics": {
                "headline": "h",
                "emotion": "Measured",
                "verified_notes": ["Standings: row"],
                "unverified_notes": [],
                "notes": [],
                "checklist": [],
                "source_status": {"athletics_standings": "verified"},
                "debug": {},
            },
            "rockies": {
                "headline": "h",
                "emotion": "Measured",
                "verified_notes": ["Standings: row"],
                "unverified_notes": [],
                "notes": [],
                "checklist": [],
                "source_status": {"rockies_standings": "verified"},
                "debug": {},
            },
            "tigers": {
                "headline": "h",
                "emotion": "Measured",
                "verified_notes": ["Standings: row"],
                "unverified_notes": [],
                "notes": [],
                "checklist": [],
                "source_status": {"tigers_standings": "verified"},
                "debug": {},
            },
        },
        "debug": {"source_health": {}},
    }


class LenientSchemaTests(unittest.TestCase):
    def test_good_snapshot_passes_lenient(self) -> None:
        problems = v.validate(_good_snapshot(), strict=False, now=_fresh_now())
        self.assertEqual(problems, [])

    def test_missing_top_keys(self) -> None:
        snap = _good_snapshot()
        del snap["league"]
        problems = v.validate(snap, strict=False, now=_fresh_now())
        self.assertTrue(any("missing top-level key: league" in p for p in problems))

    def test_invalid_source_status_value(self) -> None:
        snap = _good_snapshot()
        snap["source_status"]["league_schedule"] = "broken"
        problems = v.validate(snap, strict=False, now=_fresh_now())
        self.assertTrue(any("invalid value" in p for p in problems))

    def test_missing_team(self) -> None:
        snap = _good_snapshot()
        del snap["teams"]["tigers"]
        problems = v.validate(snap, strict=False, now=_fresh_now())
        self.assertIn("missing team: tigers", problems)


class StrictTests(unittest.TestCase):
    def test_good_snapshot_passes_strict(self) -> None:
        problems = v.validate(_good_snapshot(), strict=True, now=_fresh_now())
        self.assertEqual(problems, [])

    def test_strict_rejects_sample_fixture_marker(self) -> None:
        snap = _good_snapshot()
        snap["league"]["unverified_notes"] = ["UNVERIFIED: sample"]
        problems = v.validate(snap, strict=True, now=_fresh_now())
        self.assertTrue(any("fixture marker" in p for p in problems))

    def test_strict_rejects_empty_team_verified_notes(self) -> None:
        snap = _good_snapshot()
        snap["teams"]["tigers"]["verified_notes"] = []
        problems = v.validate(snap, strict=True, now=_fresh_now())
        self.assertTrue(any("team tigers has no verified_notes" in p for p in problems))

    def test_strict_enforces_max_age(self) -> None:
        snap = _good_snapshot()
        old = _fresh_now() - timedelta(days=3)
        snap["generated_at"] = old.isoformat().replace("+00:00", "Z")
        problems = v.validate(snap, strict=True, now=_fresh_now(), max_age_minutes=60 * 24)
        self.assertTrue(any("too stale" in p for p in problems))

    def test_strict_rejects_future_generated_at(self) -> None:
        snap = _good_snapshot()
        future = _fresh_now() + timedelta(hours=12)
        snap["generated_at"] = future.isoformat().replace("+00:00", "Z")
        problems = v.validate(snap, strict=True, now=_fresh_now())
        self.assertTrue(any("in the future" in p for p in problems))

    def test_strict_min_verified_lanes(self) -> None:
        snap = _good_snapshot()
        # Set most lanes to unverified.
        snap["source_status"] = {
            "a": "unverified",
            "b": "unverified",
            "c": "unverified",
            "d": "unverified",
        }
        problems = v.validate(snap, strict=True, now=_fresh_now(), min_verified_lanes=2)
        self.assertTrue(any("verified source lanes" in p for p in problems))

    def test_strict_rejects_iso_no_timezone(self) -> None:
        snap = _good_snapshot()
        snap["generated_at"] = "2026-05-01T12:00:00"
        problems = v.validate(snap, strict=True, now=_fresh_now())
        self.assertTrue(any("timezone-aware" in p for p in problems))


class FixtureTests(unittest.TestCase):
    def test_sample_fixture_passes_lenient(self) -> None:
        fixture_path = ROOT / "fixtures" / "sample_snapshot.json"
        if not fixture_path.exists():
            self.skipTest("fixture missing")
        data = json.loads(fixture_path.read_text(encoding="utf-8"))
        problems = v.validate(data, strict=False, now=_fresh_now())
        self.assertEqual(problems, [])

    def test_sample_fixture_passes_strict_with_relaxed_age(self) -> None:
        fixture_path = ROOT / "fixtures" / "sample_snapshot.json"
        if not fixture_path.exists():
            self.skipTest("fixture missing")
        data = json.loads(fixture_path.read_text(encoding="utf-8"))
        # Pin "now" near the fixture's frozen generated_at so freshness passes.
        anchored = datetime(2026, 5, 1, 8, 0, 0, tzinfo=timezone.utc)
        problems = v.validate(data, strict=True, now=anchored, max_age_minutes=120)
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
