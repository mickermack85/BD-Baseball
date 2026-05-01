#!/usr/bin/env python3
"""Build source-bound MLB show-prep snapshot JSON from the MLB Stats API.

Replaces the previous HTML scraping pipeline with stable JSON endpoints
on statsapi.mlb.com. Lanes that cannot be filled return explicit
``UNVERIFIED:`` / ``source_error`` entries rather than fake content.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

DATA_DIR = Path("data")
UNVERIFIED = "UNVERIFIED:"
SCHEMA_VERSION = "3.0"
USER_AGENT = "BD-Baseball-SnapshotBuilder/2.0 (+https://github.com/mickermack85/BD-Baseball)"
STATS_BASE = "https://statsapi.mlb.com/api/v1"

# Team key -> Stats API teamId.
TEAMS: dict[str, dict[str, Any]] = {
    "athletics": {"id": 133, "name": "Athletics"},
    "rockies": {"id": 115, "name": "Colorado Rockies"},
    "tigers": {"id": 116, "name": "Detroit Tigers"},
}

LEAGUE_IDS = "103,104"  # AL, NL


@dataclass
class SourceResult:
    url: str
    status: str  # verified | unverified | source_error
    verified: list[str] = field(default_factory=list)
    unverified: list[str] = field(default_factory=list)
    debug: list[str] = field(default_factory=list)


def _fetch_json(url: str, timeout: int = 30) -> tuple[Any | None, str | None]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw.decode("utf-8")), None
    except urllib.error.HTTPError as e:
        return None, f"http_error: {e.code} {e.reason}"
    except urllib.error.URLError as e:
        return None, f"url_error: {e.reason}"
    except (TimeoutError, ConnectionError) as e:
        return None, f"connection_error: {e}"
    except json.JSONDecodeError as e:
        return None, f"json_decode_error: {e}"
    except Exception as exc:  # noqa: BLE001
        return None, f"unexpected_error: {type(exc).__name__}: {exc}"


# ---------------------------- parsers (pure) ----------------------------

def parse_standings(payload: Any, url: str, team_id: int | None = None) -> SourceResult:
    """Parse /standings response.

    If ``team_id`` is provided, only that team's row is surfaced.
    """
    if not isinstance(payload, dict):
        return SourceResult(url, "source_error", debug=["payload_not_dict"])

    records = payload.get("records") or []
    rows: list[str] = []
    team_row: str | None = None
    for division in records:
        div_name = (division.get("division") or {}).get("name") or "Division"
        for tr in division.get("teamRecords") or []:
            team = tr.get("team") or {}
            name = team.get("name") or "Unknown"
            wins = tr.get("wins")
            losses = tr.get("losses")
            pct = tr.get("winningPercentage") or ""
            gb = tr.get("gamesBack") or "-"
            if wins is None or losses is None:
                continue
            line = f"{name}: {wins}-{losses} (PCT {pct}, GB {gb}) [{div_name}]"
            rows.append(line)
            if team_id is not None and team.get("id") == team_id:
                team_row = line

    debug = [f"rows={len(rows)}"]
    if team_id is not None:
        if team_row:
            return SourceResult(url, "verified", verified=[f"Standings: {team_row}"], debug=debug)
        return SourceResult(
            url,
            "unverified",
            unverified=[f"{UNVERIFIED} Standings row for teamId={team_id} not found."],
            debug=debug,
        )

    if rows:
        return SourceResult(url, "verified", verified=[f"Standings: {r}" for r in rows], debug=debug)
    return SourceResult(url, "unverified", unverified=[f"{UNVERIFIED} No standings rows present."], debug=debug)


def parse_schedule(payload: Any, url: str, team_id: int | None = None) -> SourceResult:
    """Parse /schedule with probablePitcher hydrate."""
    if not isinstance(payload, dict):
        return SourceResult(url, "source_error", debug=["payload_not_dict"])

    games_block = payload.get("dates") or []
    games: list[dict[str, Any]] = []
    for d in games_block:
        for g in d.get("games") or []:
            games.append(g)

    lines: list[str] = []
    team_lines: list[str] = []
    for g in games:
        teams = g.get("teams") or {}
        away = (teams.get("away") or {}).get("team") or {}
        home = (teams.get("home") or {}).get("team") or {}
        away_name = away.get("name") or "?"
        home_name = home.get("name") or "?"
        away_pp = ((teams.get("away") or {}).get("probablePitcher") or {}).get("fullName") or "TBD"
        home_pp = ((teams.get("home") or {}).get("probablePitcher") or {}).get("fullName") or "TBD"
        game_time = g.get("gameDate") or ""
        status = (g.get("status") or {}).get("detailedState") or ""
        venue = (g.get("venue") or {}).get("name") or ""
        line = f"{away_name} ({away_pp}) @ {home_name} ({home_pp}) — {status} {game_time} {venue}".strip()
        lines.append(line)
        if team_id is not None and (away.get("id") == team_id or home.get("id") == team_id):
            team_lines.append(line)

    debug = [f"games={len(games)}"]
    if team_id is not None:
        if team_lines:
            return SourceResult(url, "verified", verified=[f"Probable: {x}" for x in team_lines], debug=debug)
        return SourceResult(
            url,
            "unverified",
            unverified=[f"{UNVERIFIED} No scheduled game found for teamId={team_id} in window."],
            debug=debug,
        )

    if lines:
        return SourceResult(url, "verified", verified=[f"Probable: {x}" for x in lines], debug=debug)
    return SourceResult(
        url,
        "unverified",
        unverified=[f"{UNVERIFIED} No games scheduled in window."],
        debug=debug,
    )


def parse_transactions(payload: Any, url: str, label: str) -> SourceResult:
    if not isinstance(payload, dict):
        return SourceResult(url, "source_error", debug=["payload_not_dict"])

    items = payload.get("transactions") or []
    lines: list[str] = []
    for t in items:
        date = t.get("date") or ""
        desc = t.get("description") or ""
        if not desc:
            continue
        lines.append(f"{date}: {desc}".strip(": "))

    debug = [f"transactions={len(items)}"]
    if lines:
        return SourceResult(url, "verified", verified=[f"{label} tx: {x}" for x in lines], debug=debug)
    return SourceResult(
        url,
        "unverified",
        unverified=[f"{UNVERIFIED} No {label} transactions returned in window."],
        debug=debug,
    )


# ---------------------------- builder ----------------------------

def _today_utc() -> datetime:
    return datetime.now(timezone.utc)


def _date_window(days_back: int = 7) -> tuple[str, str]:
    today = _today_utc().date()
    return (today - timedelta(days=days_back)).isoformat(), today.isoformat()


def build_snapshot(fetch: Callable[[str], tuple[Any | None, str | None]] = _fetch_json) -> dict[str, Any]:
    today = _today_utc().date().isoformat()
    season = _today_utc().year
    tx_start, tx_end = _date_window(days_back=7)

    sources: dict[str, str] = {
        "league_standings": f"{STATS_BASE}/standings?leagueId={LEAGUE_IDS}&season={season}",
        "league_schedule": f"{STATS_BASE}/schedule?sportId=1&date={today}&hydrate=probablePitcher,team",
        "league_transactions": f"{STATS_BASE}/transactions?startDate={tx_start}&endDate={tx_end}",
    }
    for key, info in TEAMS.items():
        tid = info["id"]
        sources[f"{key}_schedule"] = (
            f"{STATS_BASE}/schedule?sportId=1&teamId={tid}"
            f"&startDate={today}&endDate={(_today_utc().date() + timedelta(days=2)).isoformat()}"
            f"&hydrate=probablePitcher,team"
        )
        sources[f"{key}_transactions"] = (
            f"{STATS_BASE}/transactions?teamId={tid}&startDate={tx_start}&endDate={tx_end}"
        )

    source_health: dict[str, dict[str, Any]] = {}

    def _run(key: str, parser: Callable[..., SourceResult], *parser_args: Any) -> SourceResult:
        url = sources[key]
        payload, err = fetch(url)
        if err:
            res = SourceResult(
                url,
                "source_error",
                unverified=[f"{UNVERIFIED} {key} unavailable."],
                debug=[err],
            )
        else:
            res = parser(payload, url, *parser_args)
        source_health[key] = asdict(res)
        return res

    lg_stand = _run("league_standings", parse_standings, None)
    lg_sched = _run("league_schedule", parse_schedule, None)
    lg_tx = _run("league_transactions", parse_transactions, "League")

    teams_out: dict[str, Any] = {}
    for key, info in TEAMS.items():
        tid = info["id"]
        pretty = info["name"]
        t_stand_url = sources["league_standings"]  # reuse league standings payload for team row
        # Run a per-team standings parse against league payload so we don't refetch.
        league_payload, league_err = fetch(t_stand_url)
        if league_err:
            t_stand = SourceResult(
                t_stand_url,
                "source_error",
                unverified=[f"{UNVERIFIED} {key} standings unavailable."],
                debug=[league_err],
            )
        else:
            t_stand = parse_standings(league_payload, t_stand_url, team_id=tid)
        source_health[f"{key}_standings"] = asdict(t_stand)

        t_sched = _run(f"{key}_schedule", parse_schedule, tid)
        t_tx = _run(f"{key}_transactions", parse_transactions, pretty)

        verified_notes: list[str] = []
        verified_notes.extend(t_stand.verified[:1])
        verified_notes.extend(t_sched.verified[:2])
        verified_notes.extend(t_tx.verified[:4])

        unverified_notes: list[str] = []
        unverified_notes.extend(t_stand.unverified)
        unverified_notes.extend(t_sched.unverified)
        unverified_notes.extend(t_tx.unverified)

        teams_out[key] = {
            "headline": f"{pretty} source snapshot from MLB Stats API.",
            "emotion": "Measured",
            "verified_notes": verified_notes,
            "unverified_notes": unverified_notes,
            "notes": ["Editorial framing only; do not promote UNVERIFIED entries as facts."],
            "checklist": [
                "Recheck sources before air.",
                "Promote only verified entries to on-air claims.",
            ],
            "source_status": {
                f"{key}_standings": source_health[f"{key}_standings"]["status"],
                f"{key}_schedule": source_health[f"{key}_schedule"]["status"],
                f"{key}_transactions": source_health[f"{key}_transactions"]["status"],
            },
            "debug": {
                f"{key}_standings": source_health[f"{key}_standings"]["debug"],
                f"{key}_schedule": source_health[f"{key}_schedule"]["debug"],
                f"{key}_transactions": source_health[f"{key}_transactions"]["debug"],
            },
        }

    now = _today_utc()
    return {
        "generated_at": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "schema_version": SCHEMA_VERSION,
        "sources": sources,
        "source_status": {k: v["status"] for k, v in source_health.items()},
        "league": {
            "headline": "League snapshot from MLB Stats API.",
            "verified_notes": lg_stand.verified[:8] + lg_sched.verified[:6],
            "unverified_notes": lg_stand.unverified + lg_sched.unverified,
            "stories": ["Use only verified league records/matchups/transactions for hard claims."],
            "watch": lg_sched.verified[:8]
            if lg_sched.verified
            else [f"{UNVERIFIED} No probable matchup entries available."],
            "transactions": lg_tx.verified if lg_tx.verified else lg_tx.unverified,
            "debug": {
                "standings": lg_stand.debug,
                "schedule": lg_sched.debug,
                "transactions": lg_tx.debug,
            },
        },
        "teams": teams_out,
        "debug": {
            "source_health": source_health,
            "generated_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    snap = build_snapshot()
    day = _today_utc().strftime("%Y-%m-%d")
    latest = DATA_DIR / "latest.json"
    dated = DATA_DIR / f"mlb_snapshot_{day}.json"
    latest.write_text(json.dumps(snap, indent=2), encoding="utf-8")
    dated.write_text(json.dumps(snap, indent=2), encoding="utf-8")
    logging.info("Wrote %s", latest)
    logging.info("Wrote %s", dated)


if __name__ == "__main__":
    main()
