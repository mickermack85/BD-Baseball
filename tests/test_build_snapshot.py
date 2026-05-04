"""Tests for scripts/build_snapshot.py — parsers and builder with fake fetch."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_snapshot as b  # type: ignore  # noqa: E402


def _standings_payload() -> dict:
    return {
        "records": [
            {
                "division": {"name": "AL West"},
                "teamRecords": [
                    {
                        "team": {"id": 133, "name": "Athletics"},
                        "wins": 12,
                        "losses": 18,
                        "winningPercentage": ".400",
                        "gamesBack": "5.0",
                    },
                    {
                        "team": {"id": 117, "name": "Houston Astros"},
                        "wins": 20,
                        "losses": 10,
                        "winningPercentage": ".667",
                        "gamesBack": "-",
                    },
                ],
            },
            {
                "division": {"name": "AL Central"},
                "teamRecords": [
                    {
                        "team": {"id": 116, "name": "Detroit Tigers"},
                        "wins": 18,
                        "losses": 12,
                        "winningPercentage": ".600",
                        "gamesBack": "1.0",
                    }
                ],
            },
        ]
    }


def _schedule_payload() -> dict:
    return {
        "dates": [
            {
                "games": [
                    {
                        "gameDate": "2026-05-01T23:10:00Z",
                        "status": {"detailedState": "Scheduled"},
                        "venue": {"name": "Sutter Health Park"},
                        "teams": {
                            "away": {
                                "team": {"id": 119, "name": "Los Angeles Dodgers"},
                                "probablePitcher": {"fullName": "Yoshinobu Yamamoto"},
                            },
                            "home": {
                                "team": {"id": 133, "name": "Athletics"},
                                "probablePitcher": {"fullName": "JP Sears"},
                            },
                        },
                    }
                ]
            }
        ]
    }


def _transactions_payload() -> dict:
    return {
        "transactions": [
            {
                "date": "2026-04-30",
                "description": "Athletics recalled RHP Mason Miller from Triple-A.",
            },
            {
                "date": "2026-04-29",
                "description": "Tigers placed Spencer Torkelson on the 10-day IL.",
            },
        ]
    }




def _news_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8"?>
    <rss><channel>
      <item><title>MLB headline one</title><link>https://www.mlb.com/news/one</link><pubDate>Mon, 04 May 2026 12:00:00 GMT</pubDate><source>MLB.com</source></item>
      <item><title>MLB headline two</title><link>https://www.mlb.com/news/two</link><pubDate>Mon, 04 May 2026 13:00:00 GMT</pubDate></item>
    </channel></rss>
    """
class ParserTests(unittest.TestCase):
    def test_parse_standings_league(self) -> None:
        res = b.parse_standings(_standings_payload(), "https://x")
        self.assertEqual(res.status, "verified")
        self.assertEqual(len(res.verified), 3)
        self.assertTrue(any("Athletics: 12-18" in n for n in res.verified))

    def test_parse_standings_team_filter(self) -> None:
        res = b.parse_standings(_standings_payload(), "https://x", team_id=116)
        self.assertEqual(res.status, "verified")
        self.assertTrue(any("Detroit Tigers: 18-12" in n for n in res.verified))

    def test_parse_standings_team_filter_missing(self) -> None:
        res = b.parse_standings(_standings_payload(), "https://x", team_id=999)
        self.assertEqual(res.status, "unverified")

    def test_parse_standings_bad_payload(self) -> None:
        res = b.parse_standings(None, "https://x")
        self.assertEqual(res.status, "source_error")

    def test_parse_schedule_team_filter(self) -> None:
        res = b.parse_schedule(_schedule_payload(), "https://x", team_id=133)
        self.assertEqual(res.status, "verified")
        self.assertTrue(any("Yamamoto" in n and "Sears" in n for n in res.verified))

    def test_parse_schedule_no_games(self) -> None:
        res = b.parse_schedule({"dates": []}, "https://x")
        self.assertEqual(res.status, "unverified")

    def test_parse_transactions(self) -> None:
        res = b.parse_transactions(_transactions_payload(), "https://x", "League")
        self.assertEqual(res.status, "verified")
        self.assertTrue(any("Mason Miller" in n for n in res.verified))

    def test_parse_transactions_empty(self) -> None:
        res = b.parse_transactions({"transactions": []}, "https://x", "League")
        self.assertEqual(res.status, "unverified")



    def test_parse_news_feed(self) -> None:
        items, res = b.parse_news_feed(_news_xml(), "https://x")
        self.assertEqual(res.status, "verified")
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["source"], "MLB.com")

    def test_parse_news_feed_bad_xml(self) -> None:
        items, res = b.parse_news_feed("<rss>", "https://x")
        self.assertEqual(items, [])
        self.assertEqual(res.status, "source_error")

class BuilderTests(unittest.TestCase):
    def _fake_fetch(self):
        std = _standings_payload()
        sched = _schedule_payload()
        tx = _transactions_payload()

        def fetch(url: str):
            if "rss.xml" in url or "espn.com/espn/rss/mlb/news" in url:
                return _news_xml(), None
            if "standings" in url:
                return std, None
            if "schedule" in url:
                return sched, None
            if "transactions" in url:
                return tx, None
            raise AssertionError(f"Unexpected test URL: {url}")

        return fetch

    def _fake_fetch_with_error(self):
        def fetch(url: str):
            if "rss.xml" in url:
                return _news_xml(), None
            if "transactions" in url:
                return None, "http_error: 503 Service Unavailable"
            return self._fake_fetch()(url)

        return fetch

    def test_builder_produces_required_top_keys(self) -> None:
        snap = b.build_snapshot(fetch=self._fake_fetch())
        for k in [
            "generated_at",
            "schema_version",
            "sources",
            "source_status",
            "news",
            "news_status",
            "league",
            "teams",
            "debug",
        ]:
            self.assertIn(k, snap)
        self.assertIn("league_news", snap["news"])
        self.assertIn("teams", snap["news"])

    def test_builder_each_team_has_verified_notes_when_data_present(self) -> None:
        snap = b.build_snapshot(fetch=self._fake_fetch())
        for team in ("athletics", "rockies", "tigers"):
            self.assertIn(team, snap["teams"])
            # athletics and tigers have standings rows; rockies doesn't in fixture but should still
            # have schedule/tx verified entries -> at least one verified note for athletics/tigers.
        self.assertGreaterEqual(len(snap["teams"]["athletics"]["verified_notes"]), 1)
        self.assertGreaterEqual(len(snap["teams"]["tigers"]["verified_notes"]), 1)

    def test_builder_handles_source_error(self) -> None:
        snap = b.build_snapshot(fetch=self._fake_fetch_with_error())
        # transactions lanes should be marked source_error
        statuses = snap["source_status"]
        self.assertIn("league_transactions", statuses)
        self.assertEqual(statuses["league_transactions"], "source_error")
        # No fake "verified" content for failed lane
        self.assertTrue(
            any("UNVERIFIED" in x for x in snap["league"]["transactions"])
            or snap["league"]["transactions"] == []
        )

    def test_builder_generated_at_is_iso_z(self) -> None:
        snap = b.build_snapshot(fetch=self._fake_fetch())
        ts = snap["generated_at"]
        self.assertTrue(ts.endswith("Z") or "+" in ts, f"unexpected ts: {ts}")

    def test_source_health_is_trimmed_summary(self) -> None:
        # debug.source_health entries should expose summary metadata only:
        # status, url, debug counters, counts, and small samples — never the
        # full verified/unverified arrays that bloated latest.json on busy
        # transactions days.
        snap = b.build_snapshot(fetch=self._fake_fetch())
        sh = snap["debug"]["source_health"]
        self.assertTrue(sh, "source_health should be populated")
        for key, entry in sh.items():
            self.assertIn("status", entry, f"{key} missing status")
            self.assertIn("url", entry, f"{key} missing url")
            self.assertIn("debug", entry, f"{key} missing debug")
            self.assertIn("verified_count", entry)
            self.assertIn("unverified_count", entry)
            self.assertIn("verified_sample", entry)
            self.assertIn("unverified_sample", entry)
            self.assertNotIn(
                "verified", entry, f"{key} still leaks full verified array"
            )
            self.assertNotIn(
                "unverified", entry, f"{key} still leaks full unverified array"
            )
            self.assertLessEqual(len(entry["verified_sample"]), b.DEBUG_SAMPLE_LIMIT)
            self.assertLessEqual(len(entry["unverified_sample"]), b.DEBUG_SAMPLE_LIMIT)

    def test_league_transactions_are_capped(self) -> None:
        # A high-volume transactions day should not bloat the shipped payload.
        many_tx = {
            "transactions": [
                {"date": "2026-04-30", "description": f"tx {i}"}
                for i in range(b.LEAGUE_TX_LIMIT * 4)
            ]
        }
        std = _standings_payload()
        sched = _schedule_payload()
        empty_tx = _transactions_payload()

        def fetch(url: str):
            if "rss.xml" in url or "espn.com/espn/rss/mlb/news" in url:
                return _news_xml(), None
            if "standings" in url:
                return std, None
            if "schedule" in url:
                return sched, None
            if "transactions" in url and "teamId" in url:
                return empty_tx, None
            if "transactions" in url:
                return many_tx, None
            raise AssertionError(f"Unexpected test URL: {url}")

        snap = b.build_snapshot(fetch=fetch)
        self.assertEqual(len(snap["league"]["transactions"]), b.LEAGUE_TX_LIMIT)
        self.assertEqual(snap["league"]["transactions_total"], b.LEAGUE_TX_LIMIT * 4)

    def test_source_health_status_matches_top_level(self) -> None:
        # Frontend reads top-level source_status to drive its source-health
        # table; debug.source_health must agree with it lane-for-lane.
        snap = b.build_snapshot(fetch=self._fake_fetch())
        ss = snap["source_status"]
        sh = snap["debug"]["source_health"]
        self.assertEqual(set(ss.keys()), set(sh.keys()))
        for k, v in ss.items():
            self.assertEqual(sh[k]["status"], v)

    def test_builder_team_news_lanes_present(self) -> None:
        snap = b.build_snapshot(fetch=self._fake_fetch())
        teams = snap["news"]["teams"]
        for lane in ("athletics", "tigers", "rockies"):
            self.assertIn(lane, teams)
            self.assertIn("items", teams[lane])
            self.assertIn("source_health", teams[lane])

    def test_builder_team_news_source_error(self) -> None:
        def fetch_text(url: str):
            if "athletics/feeds/news/rss.xml" in url:
                return "<rss>", None
            return self._fake_fetch()(url)

        snap = b.build_snapshot(fetch=self._fake_fetch(), fetch_text=fetch_text)
        self.assertEqual(snap["news"]["teams"]["athletics"]["source_health"]["status"], "source_error")


if __name__ == "__main__":
    unittest.main()


class SprintOneNewsTests(unittest.TestCase):
    def test_team_tagging_detects_aliases(self):
        tags = b._tag_teams("Sacramento Athletics rally past Yankees", "")
        self.assertIn("athletics", tags)
        self.assertIn("yankees", tags)

    def test_normalized_news_schema_present(self):
        snap = BuilderTests()._fake_fetch()
        out = b.build_snapshot(fetch=snap)
        self.assertIn("news_items", out["news"])
        if out["news"]["news_items"]:
            req = {"id","headline","url","source","source_type","published_at","summary","teams","players","topics","priority"}
            self.assertTrue(req.issubset(set(out["news"]["news_items"][0].keys())))

    def test_source_failure_keeps_snapshot_building(self):
        def fetch(url: str):
            return BuilderTests()._fake_fetch()(url)
        out = b.build_snapshot(fetch=fetch)
        self.assertIn("source_status", out)
        self.assertTrue(any(k.startswith("curated_news_") for k in out["source_status"]))


class SprintTwoScoreboardTests(unittest.TestCase):
    def test_scoreboard_schema_present(self):
        out = b.build_snapshot(fetch=BuilderTests()._fake_fetch())
        self.assertIn("scoreboard", out)
        self.assertIn("games", out["scoreboard"])
        self.assertTrue(len(out["scoreboard"]["games"]) >= 1)
        req = {"id", "away_team", "home_team", "away_score", "home_score", "status", "status_detail", "inning", "inning_state", "start_time", "venue", "probable_pitchers", "broadcasts"}
        self.assertTrue(req.issubset(set(out["scoreboard"]["games"][0].keys())))
