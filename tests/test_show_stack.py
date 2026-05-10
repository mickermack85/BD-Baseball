"""Tests for the deterministic show stack / storyline ranking and BD Bets
top-angle trimming.

Both helpers are pure JS functions on (snapshot, options); we drive them by
shelling out to ``node`` the same way the existing show-generator tests do.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "show_generator.js"


def _node() -> str | None:
    return shutil.which("node")


def _run(script: str, env_payload: dict) -> str:
    env = os.environ.copy()
    for k, v in env_payload.items():
        env[k] = json.dumps(v)
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
    return res.stdout


def _build_show_stack(snapshot: dict, options: dict):
    script = (
        "const G = require('./show_generator.js');"
        "const snap = JSON.parse(process.env.SNAP);"
        "const opts = JSON.parse(process.env.OPTS);"
        "process.stdout.write(JSON.stringify(G.buildShowStack(snap, opts)));"
    )
    out = _run(script, {"SNAP": snapshot, "OPTS": options})
    return json.loads(out)


def _select_top_bets(picks, limit):
    script = (
        "const G = require('./show_generator.js');"
        "const picks = JSON.parse(process.env.PICKS);"
        "const limit = JSON.parse(process.env.LIMIT);"
        "process.stdout.write(JSON.stringify(G.selectTopBdBetsAngles(picks, limit)));"
    )
    out = _run(script, {"PICKS": picks, "LIMIT": limit})
    return json.loads(out)


def _scoreboard_snapshot() -> dict:
    return {
        "generated_at": "2026-05-01T12:00:00Z",
        "schema_version": "3.2",
        "sources": {},
        "source_status": {
            "league_standings": "verified",
            "league_schedule": "verified",
            "league_transactions": "verified",
        },
        "scoreboard": {
            "games": [
                {
                    "id": "g1", "away_team": "Cleveland Guardians", "home_team": "Athletics",
                    "away_score": None, "home_score": None,
                    "status": "Upcoming", "status_detail": "Scheduled",
                    "inning": None, "inning_state": "",
                    "start_time": "2026-05-01T22:05:00Z", "venue": "Sutter Health Park",
                    "probable_pitchers": {"away": "Joey Cantillo", "home": "J.T. Ginn"},
                    "broadcasts": [],
                },
                {
                    "id": "g2", "away_team": "Texas Rangers", "home_team": "Detroit Tigers",
                    "away_score": None, "home_score": None,
                    "status": "Upcoming", "status_detail": "Scheduled",
                    "inning": None, "inning_state": "",
                    "start_time": "2026-05-01T23:10:00Z", "venue": "Comerica Park",
                    "probable_pitchers": {"away": "MacKenzie Gore", "home": "Jack Flaherty"},
                    "broadcasts": [],
                },
                {
                    "id": "g3", "away_team": "Houston Astros", "home_team": "New York Yankees",
                    "away_score": None, "home_score": None,
                    "status": "Upcoming", "status_detail": "Scheduled",
                    "inning": None, "inning_state": "",
                    "start_time": "2026-05-02T00:00:00Z", "venue": "Yankee Stadium",
                    "probable_pitchers": {"away": "Framber Valdez", "home": "Gerrit Cole"},
                    "broadcasts": [],
                },
            ],
        },
        "league": {
            "headline": "League snapshot",
            "verified_notes": [
                "Standings: Houston Astros: 22-9 (PCT .710, GB -) [AL West]",
                "Standings: New York Yankees: 21-10 (PCT .677, GB -) [AL East]",
                "Standings: Detroit Tigers: 18-13 (PCT .581, GB 1.5) [AL Central]",
                "Standings: Athletics: 12-19 (PCT .387, GB 9.0) [AL West]",
                "Probable: Cleveland Guardians (Joey Cantillo) @ Athletics (J.T. Ginn) — Scheduled 2026-05-01T22:05:00Z Sutter Health Park",
                "Probable: Texas Rangers (MacKenzie Gore) @ Detroit Tigers (Jack Flaherty) — Scheduled 2026-05-01T23:10:00Z Comerica Park",
            ],
            "unverified_notes": [],
            "transactions": [
                "League tx: 2026-04-30: Athletics activated RHP Mason Miller from the 15-day injured list.",
                "League tx: 2026-04-30: Detroit Tigers placed Spencer Torkelson on the 10-day injured list.",
                "League tx: 2026-04-30: Some random Mexican League move involving Tijuana Bulls.",
            ],
            "watch": [],
            "debug": {},
        },
        "teams": {},
        "debug": {},
    }


@unittest.skipIf(_node() is None, "node not available")
class ShowStackTests(unittest.TestCase):
    def test_focus_team_game_leads(self) -> None:
        snap = _scoreboard_snapshot()
        stack = _build_show_stack(snap, {"teams": ["athletics"], "limit": 8})
        self.assertGreaterEqual(len(stack), 1)
        lead = stack[0]
        self.assertEqual(lead["kind"], "focus_game")
        self.assertEqual(lead["team"], "athletics")
        self.assertIn("Athletics", lead["headline"])

    def test_marquee_matchup_when_no_focus_overlap(self) -> None:
        snap = _scoreboard_snapshot()
        stack = _build_show_stack(snap, {"teams": ["rockies"], "limit": 8})
        # Rockies have no game today; lead becomes a marquee matchup
        # (top-of-standings clubs facing each other).
        kinds = [s["kind"] for s in stack]
        self.assertIn("marquee", kinds)

    def test_standings_context_present(self) -> None:
        snap = _scoreboard_snapshot()
        stack = _build_show_stack(snap, {"teams": [], "limit": 8})
        kinds = [s["kind"] for s in stack]
        self.assertIn("standings", kinds)

    def test_transaction_filter_drops_non_mlb_noise(self) -> None:
        snap = _scoreboard_snapshot()
        stack = _build_show_stack(snap, {"teams": ["athletics", "tigers"], "limit": 8})
        tx = [s for s in stack if s["kind"] == "transaction"]
        self.assertTrue(tx, "expected at least one MLB transaction storyline")
        for entry in tx:
            self.assertNotIn("Tijuana", entry["headline"])

    def test_bd_bets_only_one_compact_entry(self) -> None:
        snap = _scoreboard_snapshot()
        snap["bd_bets"] = {
            "generated_at": "2026-05-01T13:00:00Z",
            "slate_date": "2026-05-01",
            "sport": "MLB",
            "source": "bd_bets",
            "picks": [
                {"away_team": "Texas Rangers", "home_team": "Detroit Tigers", "market": "total",
                 "pick": "Under 8.5", "confidence": "high", "edge": "+6.1%",
                 "model_note": "Two contact starters; wind in.", "status": "open"},
                {"away_team": "Cleveland Guardians", "home_team": "Athletics", "market": "moneyline",
                 "pick": "Athletics +180", "confidence": "medium", "edge": "+4.2%",
                 "model_note": "Travel spot.", "status": "open"},
                {"away_team": "Houston Astros", "home_team": "New York Yankees", "market": "runline",
                 "pick": "Yankees -1.5", "confidence": "low", "edge": "+0.3%",
                 "model_note": "Coin flip per model.", "status": "open"},
            ],
            "insights": [],
            "source_status": "verified",
        }
        stack = _build_show_stack(snap, {"teams": ["athletics", "tigers"], "limit": 8})
        bets = [s for s in stack if s["kind"] == "bd_bets"]
        self.assertEqual(len(bets), 1, "stack must surface only ONE compact BD Bets angle")
        # Highest-confidence open pick should be selected.
        self.assertIn("Texas Rangers", bets[0]["headline"])

    def test_empty_snapshot_returns_no_data_marker(self) -> None:
        empty = {
            "generated_at": "2026-05-01T00:00:00Z", "schema_version": "3.2",
            "sources": {}, "source_status": {},
            "scoreboard": {"games": []},
            "league": {"verified_notes": [], "unverified_notes": [], "transactions": [],
                       "watch": [], "debug": {}},
            "teams": {}, "debug": {},
        }
        stack = _build_show_stack(empty, {"teams": [], "limit": 8})
        self.assertEqual(len(stack), 1)
        self.assertEqual(stack[0]["kind"], "empty")
        self.assertIn("No verified storylines", stack[0]["headline"])

    def test_deterministic(self) -> None:
        snap = _scoreboard_snapshot()
        opts = {"teams": ["athletics", "tigers"], "limit": 8}
        a = _build_show_stack(snap, opts)
        b = _build_show_stack(snap, opts)
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))


@unittest.skipIf(_node() is None, "node not available")
class TopBdBetsAnglesTests(unittest.TestCase):
    def test_caps_at_limit(self) -> None:
        picks = [
            {"away_team": f"Away{i}", "home_team": f"Home{i}", "market": "moneyline",
             "pick": f"Home{i}", "confidence": "medium", "edge": "+1%",
             "model_note": "x", "status": "open"}
            for i in range(20)
        ]
        out = _select_top_bets(picks, 5)
        self.assertEqual(len(out), 5)

    def test_high_confidence_first(self) -> None:
        picks = [
            {"away_team": "A1", "home_team": "B1", "market": "ml", "pick": "x",
             "confidence": "low", "edge": "+0.5%", "model_note": "n", "status": "open"},
            {"away_team": "A2", "home_team": "B2", "market": "ml", "pick": "x",
             "confidence": "high", "edge": "+5%", "model_note": "n", "status": "open"},
            {"away_team": "A3", "home_team": "B3", "market": "ml", "pick": "x",
             "confidence": "medium", "edge": "+3%", "model_note": "n", "status": "open"},
        ]
        out = _select_top_bets(picks, 3)
        self.assertEqual(out[0]["away_team"], "A2")
        self.assertEqual(out[1]["away_team"], "A3")
        self.assertEqual(out[2]["away_team"], "A1")

    def test_open_before_settled(self) -> None:
        picks = [
            {"away_team": "Settled", "home_team": "X", "market": "ml", "pick": "x",
             "confidence": "high", "edge": "+10%", "model_note": "n", "status": "win"},
            {"away_team": "Open", "home_team": "X", "market": "ml", "pick": "x",
             "confidence": "medium", "edge": "+1%", "model_note": "n", "status": "open"},
        ]
        out = _select_top_bets(picks, 2)
        # Open pick beats settled even when settled has higher score.
        self.assertEqual(out[0]["away_team"], "Open")

    def test_empty_input(self) -> None:
        self.assertEqual(_select_top_bets([], 5), [])

    def test_uses_default_limit_when_zero(self) -> None:
        picks = [
            {"away_team": f"A{i}", "home_team": f"H{i}", "market": "ml", "pick": "x",
             "confidence": "medium", "edge": "+1%", "model_note": "n", "status": "open"}
            for i in range(10)
        ]
        out = _select_top_bets(picks, 0)
        self.assertEqual(len(out), 5)  # default cap


@unittest.skipIf(_node() is None, "node not available")
class StorylineFirstShowGeneratorTests(unittest.TestCase):
    """The opener / livestream long description must lead with storylines,
    not BD Bets. BD Bets is one optional entry inside the stack."""

    def _render(self, snap, opts):
        script = (
            "const G = require('./show_generator.js');"
            "const snap = JSON.parse(process.env.SNAP);"
            "const opts = JSON.parse(process.env.OPTS);"
            "const r = G.generateRundown(snap, opts);"
            "const pkg = G.generateLivestreamPackage(snap, r, opts);"
            "process.stdout.write(JSON.stringify({"
            "  opener: r.segments.find(s => s.id === 'opener'),"
            "  longDesc: pkg.longDescription,"
            "}));"
        )
        out = _run(script, {"SNAP": snap, "OPTS": opts})
        return json.loads(out)

    def test_opener_leads_with_baseball_storyline(self) -> None:
        snap = _scoreboard_snapshot()
        snap["bd_bets"] = {
            "generated_at": "2026-05-01T13:00:00Z", "slate_date": "2026-05-01",
            "sport": "MLB", "source": "bd_bets",
            "picks": [
                {"away_team": "Texas Rangers", "home_team": "Detroit Tigers",
                 "market": "total", "pick": "Under 8.5", "confidence": "high",
                 "edge": "+6.1%", "model_note": "Pitchers' park.", "status": "open"},
            ],
            "insights": [], "source_status": "verified",
        }
        out = self._render(snap, {"preset": "standard", "teams": ["athletics", "tigers"]})
        opener_lines = " ".join(out["opener"]["lines"])
        # Opener must NOT start with BD Bets framing.
        self.assertNotIn("BD Bets angle", out["opener"]["lines"][0])
        # Opener must mention baseball context (a focus team is the strongest hook).
        self.assertTrue(
            "Athletics" in opener_lines or "Tigers" in opener_lines or
            "matchup" in opener_lines.lower() or "standings" in opener_lines.lower(),
            "opener should lead with baseball context, got: " + opener_lines,
        )

    def test_long_description_includes_storylines_section(self) -> None:
        snap = _scoreboard_snapshot()
        out = self._render(snap, {"preset": "standard", "teams": ["athletics"]})
        self.assertIn("Today's storylines:", out["longDesc"])


class StaticIntegrationTests(unittest.TestCase):
    def test_show_generator_exports_show_stack_helpers(self) -> None:
        text = GEN.read_text(encoding="utf-8")
        for name in ["buildShowStack", "selectTopBdBetsAngles"]:
            self.assertIn(name, text, f"show_generator.js missing {name}")

    def test_index_html_has_today_desk_section(self) -> None:
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="todayDeskCard"', html)
        self.assertIn('id="deskStorylines"', html)
        self.assertIn('id="deskScoreboard"', html)
        self.assertIn('id="deskFocusTeams"', html)
        self.assertIn('id="deskBdBets"', html)

    def test_app_js_renders_today_desk(self) -> None:
        text = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn("renderTodayDesk", text)
        # Still no innerHTML interpolation.
        self.assertNotIn(".innerHTML", text)


if __name__ == "__main__":
    unittest.main()
