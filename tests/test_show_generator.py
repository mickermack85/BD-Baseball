"""Tests for the show generator JS module.

The generator is intentionally a pure function of (snapshot, options): no DOM,
no fetch, no clocks. We drive it from Python by invoking ``node -e`` and
inspect the output. This keeps the harness stdlib-only.

If ``node`` isn't on PATH the JS-driven tests are skipped — the static checks
on the file structure still run.
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
APP = ROOT / "app.js"
INDEX = ROOT / "index.html"
LATEST = ROOT / "data" / "latest.json"


def _node() -> str | None:
    return shutil.which("node")


def _run_node(script: str) -> str:
    res = subprocess.run(
        ["node", "-e", script],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=20,
    )
    if res.returncode != 0:
        raise AssertionError(
            "node script failed:\nSTDOUT:\n" + res.stdout + "\nSTDERR:\n" + res.stderr
        )
    return res.stdout


class StaticStructureTests(unittest.TestCase):
    def test_show_generator_file_exists_and_exports(self) -> None:
        self.assertTrue(GEN.exists(), "show_generator.js missing")
        text = GEN.read_text(encoding="utf-8")
        for fn in [
            "generateRundown",
            "renderRundownText",
            "renderTeleprompter",
            "summarizeConfidence",
        ]:
            self.assertIn(fn, text, f"expected function {fn} not in show_generator.js")
        self.assertIn("module.exports", text, "show_generator.js must be Node-importable")
        self.assertIn("window.BDShowGenerator", text, "show_generator.js must expose window global")

    def test_app_js_exists_and_wires_controls(self) -> None:
        self.assertTrue(APP.exists(), "app.js missing")
        text = APP.read_text(encoding="utf-8")
        # Generator wiring is required.
        for hook in [
            "regenerateRundown",
            "BDShowGenerator",
            "presetSelect",
            "copyRundownBtn",
            "copyTeleBtn",
            "printHostBtn",
        ]:
            self.assertIn(hook, text, f"app.js missing {hook}")
        # Safety: never use innerHTML interpolation of snapshot fields.
        self.assertNotIn(".innerHTML", text, "app.js must not use innerHTML")

    def test_index_html_has_generator_controls(self) -> None:
        self.assertTrue(INDEX.exists(), "index.html missing")
        html = INDEX.read_text(encoding="utf-8")
        for tok in [
            'id="presetSelect"',
            'id="genBtn"',
            'id="copyRundownBtn"',
            'id="copyTeleBtn"',
            'id="printHostBtn"',
            'id="rundownOut"',
            'id="hostScriptOut"',
            'id="teamLanes"',
            "show_generator.js",
            "app.js",
        ]:
            self.assertIn(tok, html, f"index.html missing required token: {tok}")

    def test_index_html_does_not_emit_unverified_placeholder_string(self) -> None:
        html = INDEX.read_text(encoding="utf-8")
        # The old viewer wrote 'UNVERIFIED: No league unverified notes listed.'
        # as fake content. The new viewer never renders that string.
        self.assertNotIn("UNVERIFIED: No league", html)


@unittest.skipIf(_node() is None, "node not available")
class GeneratorBehaviourTests(unittest.TestCase):
    def _generate(self, snapshot: dict, options: dict) -> dict:
        script = (
            "const G = require('./show_generator.js');"
            "const snap = JSON.parse(process.env.SNAP);"
            "const opts = JSON.parse(process.env.OPTS);"
            "const r = G.generateRundown(snap, opts);"
            "process.stdout.write(JSON.stringify(r));"
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

    def _render(self, snapshot: dict, options: dict) -> tuple[str, str]:
        script = (
            "const G = require('./show_generator.js');"
            "const snap = JSON.parse(process.env.SNAP);"
            "const opts = JSON.parse(process.env.OPTS);"
            "const r = G.generateRundown(snap, opts);"
            "process.stdout.write("
            "  JSON.stringify({"
            "    rundown: G.renderRundownText(r),"
            "    teleprompter: G.renderTeleprompter(r, snap)"
            "  })"
            ");"
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
        out = json.loads(res.stdout)
        return out["rundown"], out["teleprompter"]

    def _load_latest(self) -> dict:
        return json.loads(LATEST.read_text(encoding="utf-8"))

    def test_durations_match_preset_targets(self) -> None:
        snap = self._load_latest()
        for preset, target in [("quick", 15), ("standard", 25), ("deep", 35)]:
            r = self._generate(snap, {"preset": preset, "teams": ["athletics", "rockies", "tigers"]})
            self.assertEqual(r["targetMinutes"], target)
            # Allow the team budget to push total slightly over target —
            # but never wildly off.
            self.assertGreaterEqual(r["totalMinutes"], target)
            self.assertLessEqual(r["totalMinutes"], target + 12)

    def test_segments_present_in_expected_order(self) -> None:
        snap = self._load_latest()
        r = self._generate(snap, {"preset": "standard", "teams": ["athletics", "tigers"]})
        ids = [s["id"] for s in r["segments"]]
        self.assertEqual(ids[0], "opener")
        self.assertEqual(ids[1], "league")
        self.assertEqual(ids[2], "slate")
        self.assertEqual(ids[3], "transactions")
        self.assertIn("team_athletics", ids)
        self.assertIn("team_tigers", ids)
        self.assertEqual(ids[-1], "closer")
        # No unconfigured team should show up.
        self.assertNotIn("team_rockies", ids)

    def test_deterministic_output(self) -> None:
        snap = self._load_latest()
        opts = {"preset": "standard", "teams": ["athletics", "rockies", "tigers"]}
        a = self._generate(snap, opts)
        b = self._generate(snap, opts)
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))

    def test_handles_empty_snapshot_gracefully(self) -> None:
        empty = {
            "generated_at": "2026-05-01T00:00:00Z",
            "schema_version": "3.1",
            "sources": {},
            "source_status": {},
            "league": {"verified_notes": [], "unverified_notes": [], "transactions": [], "watch": [], "debug": {}},
            "teams": {},
            "debug": {},
        }
        r = self._generate(empty, {"preset": "quick", "teams": []})
        # Generator must not throw and must still allocate target time.
        self.assertEqual(r["targetMinutes"], 15)
        self.assertGreaterEqual(r["totalMinutes"], 1)
        # No team blocks.
        for s in r["segments"]:
            self.assertFalse(s["id"].startswith("team_"))

    def test_teleprompter_avoids_false_unverified_claim(self) -> None:
        snap = self._load_latest()
        rundown_text, host_text = self._render(snap, {"preset": "quick", "teams": ["athletics"]})
        # When all consulted lanes are verified, the teleprompter must NOT
        # emit a generic "unverified" claim about them.
        self.assertNotIn("WARNING: source error", host_text)
        # Confidence labels should reflect verified-across-N-lanes phrasing.
        self.assertIn("verified across", host_text)
        # Rundown header should match selected preset.
        self.assertIn("15-min Quick Hit", rundown_text)

    def test_teleprompter_flags_unverified_when_lanes_are_bad(self) -> None:
        snap = self._load_latest()
        # Simulate a bad lane: flip league_standings to source_error.
        snap = json.loads(json.dumps(snap))
        snap["source_status"]["league_standings"] = "source_error"
        snap["source_status"]["league_schedule"] = "source_error"
        snap["source_status"]["league_transactions"] = "source_error"
        _, host_text = self._render(snap, {"preset": "quick", "teams": []})
        # The opener segment consulted league lanes — surface the warning.
        self.assertIn("WARNING: source error", host_text)

    def test_team_segment_uses_team_verified_notes(self) -> None:
        snap = self._load_latest()
        r = self._generate(snap, {"preset": "standard", "teams": ["tigers"]})
        team_seg = next(s for s in r["segments"] if s["id"] == "team_tigers")
        joined = " ".join(team_seg["lines"])
        self.assertIn("Detroit Tigers", joined)
        # Verified standings for Tigers in the latest snapshot.
        self.assertIn("Tigers: 16-16", joined)

    def test_host_script_includes_segment_transitions(self) -> None:
        snap = self._load_latest()
        _, host_text = self._render(snap, {"preset": "standard", "teams": ["athletics"]})
        self.assertIn("[transition]", host_text)
        self.assertIn("==", host_text)
        # No raw "UNVERIFIED:" lines should leak into spoken copy when there
        # are no actual unverified notes in the snapshot.
        # (The current latest.json has no league unverified notes.)
        self.assertNotIn("UNVERIFIED:", host_text)


if __name__ == "__main__":
    unittest.main()
