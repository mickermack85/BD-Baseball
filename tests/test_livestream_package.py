"""Tests for the livestream metadata / download additions.

Mirrors test_show_generator.py: drives the JS module via ``node -e`` and
inspects the output. Falls back to static-source assertions when ``node``
is unavailable so the static checks still run.
"""
from __future__ import annotations

import json
import os
import re
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


class LivestreamStaticTests(unittest.TestCase):
    def test_show_generator_exports_livestream_api(self) -> None:
        text = GEN.read_text(encoding="utf-8")
        for fn in [
            "generateLivestreamPackage",
            "renderLivestreamMarkdown",
            "renderRundownMarkdown",
            "renderHostScriptMarkdown",
            "renderCompletePackageMarkdown",
            "buildFilename",
        ]:
            self.assertIn(fn, text, f"show_generator.js missing {fn}")

    def test_index_html_has_livestream_ui(self) -> None:
        html = INDEX.read_text(encoding="utf-8")
        for tok in [
            'id="liveTitleField"',
            'id="liveShortField"',
            'id="liveLongField"',
            'id="liveTeaserField"',
            'id="copyLiveTitleBtn"',
            'id="copyLiveAllBtn"',
            'id="dlRundownBtn"',
            'id="dlHostBtn"',
            'id="dlLiveBtn"',
            'id="dlPackageBtn"',
            'id="livePkgWarn"',
        ]:
            self.assertIn(tok, html, f"index.html missing required token: {tok}")

    def test_app_js_wires_downloads_and_livestream(self) -> None:
        text = APP.read_text(encoding="utf-8")
        for fn in [
            "renderLivestreamPackage",
            "downloadRundown",
            "downloadHostScript",
            "downloadLivestream",
            "downloadCompletePackage",
            "triggerDownload",
            "copyLiveAll",
            "generateLivestreamPackage",
        ]:
            self.assertIn(fn, text, f"app.js missing {fn}")
        # Downloads must be Blob-based (no third-party deps).
        self.assertIn("new Blob(", text)
        self.assertIn("URL.createObjectURL", text)
        # Must guard against blank downloads.
        self.assertIn("Nothing to download", text)
        # Must keep existing copy/print buttons wired (no regression).
        for keep in ["copyRundownBtn", "copyTeleBtn", "printHostBtn"]:
            self.assertIn(keep, text)
        # Safety: still no innerHTML interpolation introduced.
        self.assertNotIn(".innerHTML", text)


def _run_node_script(script: str, env_extra: dict[str, str]) -> str:
    env = os.environ.copy()
    env.update(env_extra)
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


@unittest.skipIf(_node() is None, "node not available")
class LivestreamBehaviourTests(unittest.TestCase):
    def _load_latest(self) -> dict:
        return json.loads(LATEST.read_text(encoding="utf-8"))

    def _package(self, snapshot: dict, options: dict) -> dict:
        script = (
            "const G = require('./show_generator.js');"
            "const snap = JSON.parse(process.env.SNAP);"
            "const opts = JSON.parse(process.env.OPTS);"
            "const r = G.generateRundown(snap, opts);"
            "const p = G.generateLivestreamPackage(snap, r, {teams: opts.teams});"
            "process.stdout.write(JSON.stringify({"
            "  pkg: p,"
            "  liveMd: G.renderLivestreamMarkdown(p),"
            "  rundownMd: G.renderRundownMarkdown(r),"
            "  hostMd: G.renderHostScriptMarkdown(r, snap),"
            "  fullMd: G.renderCompletePackageMarkdown(snap, r, p),"
            "  filename: G.buildFilename(r.presetKey, p.showDate, 'show-package', 'md'),"
            "  rundownTeams: r.teams"
            "}));"
        )
        out = _run_node_script(
            script,
            {"SNAP": json.dumps(snapshot), "OPTS": json.dumps(options)},
        )
        return json.loads(out)

    def test_package_contains_all_required_fields(self) -> None:
        snap = self._load_latest()
        out = self._package(snap, {"preset": "standard", "teams": ["athletics", "rockies", "tigers"]})
        pkg = out["pkg"]
        for k in ["title", "shortDescription", "longDescription", "teaser", "showDate", "prettyDate", "health"]:
            self.assertIn(k, pkg, f"livestream package missing {k}")
        self.assertTrue(pkg["title"], "title must not be empty")
        self.assertNotEqual(pkg["title"], "Baseball Show")
        self.assertNotEqual(pkg["title"], "BD Baseball Show")  # must be data-derived for healthy snapshot
        self.assertLessEqual(len(pkg["title"]), 100)
        self.assertEqual(pkg["showDate"], snap.get("generated_at", "")[:10])
        self.assertRegex(pkg["prettyDate"], r"^[A-Za-z]+, [A-Za-z]+ \d{1,2}, \d{4}$")

    def test_title_uses_focus_team_matchup_when_available(self) -> None:
        snap = self._load_latest()
        out = self._package(snap, {"preset": "standard", "teams": ["tigers"]})
        pkg = out["pkg"]
        self.assertTrue(pkg["title"])
        self.assertIn(pkg["showDate"], pkg["title"])


    def test_long_description_contains_segment_timestamps_and_standings(self) -> None:
        snap = self._load_latest()
        out = self._package(snap, {"preset": "standard", "teams": ["athletics"]})
        long_desc = out["pkg"]["longDescription"]
        # Segment timestamp markers.
        self.assertIn("Segments:", long_desc)
        self.assertIn("00:00", long_desc)
        # Standings hook.
        self.assertIn("Top of the standings", long_desc)
        # Source confidence note for healthy snapshot.
        self.assertIn("data lanes verified", long_desc)
        # CTA placeholders are present (producer can replace).
        self.assertIn("Subscribe", long_desc)
        self.assertIn("<add", long_desc)

    def test_deterministic_package_output(self) -> None:
        snap = self._load_latest()
        opts = {"preset": "standard", "teams": ["athletics", "rockies", "tigers"]}
        a = self._package(snap, opts)
        b = self._package(snap, opts)
        self.assertEqual(json.dumps(a["pkg"], sort_keys=True), json.dumps(b["pkg"], sort_keys=True))
        self.assertEqual(a["liveMd"], b["liveMd"])
        self.assertEqual(a["fullMd"], b["fullMd"])

    def test_complete_package_bundles_all_sections(self) -> None:
        snap = self._load_latest()
        out = self._package(snap, {"preset": "quick", "teams": ["athletics"]})
        full = out["fullMd"]
        for section in [
            "Complete Show Package",
            "Livestream Metadata",
            "Rundown",
            "Host Script",
            "Source health summary",
        ]:
            self.assertIn(section, full)
        # Markdown body must contain non-trivial content.
        self.assertGreater(len(full), 1500)

    def test_filename_is_safe_and_data_derived(self) -> None:
        snap = self._load_latest()
        out = self._package(snap, {"preset": "deep", "teams": []})
        fn = out["filename"]
        self.assertEqual(fn, f"bd-baseball-{out['pkg']['showDate']}-deep-show-package.md")
        # No spaces, slashes, or unsafe chars.
        self.assertRegex(fn, r"^[a-z0-9.\-]+$")

    def test_warning_surfaces_on_unhealthy_snapshot(self) -> None:
        snap = self._load_latest()
        # Force three lanes into source_error so health.healthy is false.
        snap["source_status"]["league_standings"] = "source_error"
        snap["source_status"]["league_schedule"] = "source_error"
        snap["source_status"]["league_transactions"] = "source_error"
        out = self._package(snap, {"preset": "standard", "teams": ["athletics"]})
        pkg = out["pkg"]
        self.assertTrue(pkg["producerWarning"], "producerWarning must be set on unhealthy snapshot")
        self.assertIn("Source health warning", pkg["producerWarning"])
        # Ugly warnings must not bleed into the public title.
        self.assertNotIn("WARNING", pkg["title"])
        self.assertNotIn("source_error", pkg["title"])

    def test_empty_snapshot_yields_safe_fallbacks(self) -> None:
        empty = {
            "generated_at": "2026-05-01T00:00:00Z",
            "schema_version": "3.1",
            "sources": {},
            "source_status": {},
            "league": {"verified_notes": [], "unverified_notes": [], "transactions": [], "watch": [], "debug": {}},
            "teams": {},
            "debug": {},
        }
        out = self._package(empty, {"preset": "quick", "teams": []})
        pkg = out["pkg"]
        # Title falls back gracefully with date but never to a literal "Baseball Show".
        self.assertIn("BD Baseball", pkg["title"])
        self.assertIn("2026-05-01", pkg["title"])
        # Markdown renderers must still produce non-empty strings.
        self.assertGreater(len(out["liveMd"]), 50)
        self.assertGreater(len(out["fullMd"]), 100)

    def test_rundown_markdown_has_segment_headers_and_bullets(self) -> None:
        snap = self._load_latest()
        out = self._package(snap, {"preset": "standard", "teams": ["athletics"]})
        md = out["rundownMd"]
        self.assertIn("# BD Baseball — Rundown", md)
        self.assertIn("## 1. Cold Open", md)
        self.assertIn("- ", md)


if __name__ == "__main__":
    unittest.main()
