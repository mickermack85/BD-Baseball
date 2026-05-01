#!/usr/bin/env python3
"""Build source-bound MLB show-prep snapshot JSON."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
import json
import logging
import re
from typing import Any, Callable

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

DATA_DIR = Path("data")
TEAM_KEYS = ["athletics", "rockies", "tigers"]
UNVERIFIED = "UNVERIFIED:"

URLS = {
    "league_standings": "https://www.mlb.com/standings",
    "league_probables": "https://www.mlb.com/probable-pitchers",
    "league_transactions": "https://www.espn.com/mlb/transactions",
    "athletics_standings": "https://www.mlb.com/athletics/standings/mlb",
    "athletics_probables": "https://www.mlb.com/athletics/roster/probable-pitchers",
    "athletics_transactions": "https://www.mlb.com/athletics/roster/transactions",
    "athletics_savant": "https://baseballsavant.mlb.com/team/133",
    "athletics_espn_transactions": "https://www.espn.com/mlb/team/transactions/_/name/ath/athletics",
    "rockies_standings": "https://www.mlb.com/rockies/standings",
    "rockies_probables": "https://www.mlb.com/rockies/roster/probable-pitchers",
    "rockies_transactions": "https://www.mlb.com/rockies/roster/transactions",
    "rockies_savant": "https://baseballsavant.mlb.com/team/115",
    "rockies_espn_transactions": "https://www.espn.com/mlb/team/transactions/_/name/col/colorado-rockies",
    "tigers_standings": "https://www.mlb.com/tigers/standings/league",
    "tigers_probables": "https://www.mlb.com/tigers/roster/probable-pitchers",
    "tigers_transactions": "https://www.mlb.com/tigers/roster/transactions",
    "tigers_savant": "https://baseballsavant.mlb.com/team/116",
    "tigers_espn_transactions": "https://www.espn.com/mlb/team/transactions/_/name/det/detroit-tigers",
}


@dataclass
class SourceResult:
    url: str
    status: str  # verified | unverified | source_error
    verified: list[str]
    unverified: list[str]
    debug: list[str]


def build_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(total=3, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504])
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.headers.update({"User-Agent": "BD-Baseball-SnapshotBuilder/1.1"})
    return s


def fetch_html(session: requests.Session, url: str) -> tuple[str | None, str | None]:
    try:
        r = session.get(url, timeout=30)
        r.raise_for_status()
        return r.text, None
    except Exception as exc:  # noqa: BLE001
        return None, f"source_error: {exc}"


def text_from_html(html: str) -> str:
    return " ".join(BeautifulSoup(html, "html.parser").get_text(" ", strip=True).split())


def parse_standings(html: str, url: str) -> SourceResult:
    matches = re.findall(r"([A-Z][A-Za-z.'\- ]{2,30})\s+(\d{1,2})-(\d{1,2})", text_from_html(html))
    records: list[str] = []
    for name, w, l in matches:
        row = f"{name.strip()}: {w}-{l}"
        if row not in records:
            records.append(row)
        if len(records) >= 8:
            break
    if records:
        return SourceResult(url, "verified", [f"Standings snapshot: {r}" for r in records], [], [f"records_found={len(records)}"])
    return SourceResult(url, "unverified", [], [f"{UNVERIFIED} Standings table not confidently parsed."], ["records_found=0"])


def parse_probables(html: str, url: str) -> SourceResult:
    matches = re.findall(r"([A-Z][A-Za-z.'\- ]{2,25})\s+vs\.?\s+([A-Z][A-Za-z.'\- ]{2,25})", text_from_html(html))
    games: list[str] = []
    for away, home in matches:
        row = f"{away.strip()} vs {home.strip()}"
        if row not in games:
            games.append(row)
        if len(games) >= 8:
            break
    if games:
        return SourceResult(url, "verified", [f"Probable matchup: {g}" for g in games], [], [f"matchups_found={len(games)}"])
    return SourceResult(url, "unverified", [], [f"{UNVERIFIED} Probable pitcher slate not confidently parsed."], ["matchups_found=0"])


def parse_transactions(html: str, url: str, label: str) -> SourceResult:
    text = text_from_html(html)
    pattern = r"((?:placed|recalled|selected|transferred|optioned|assigned|activated|agreed|signed|claimed|acquired|traded).{0,180}?\.)"
    lines = []
    for line in re.findall(pattern, text, flags=re.I):
        item = line.strip()
        if item not in lines:
            lines.append(item)
        if len(lines) >= 6:
            break
    if lines:
        return SourceResult(url, "verified", [f"{label}: {x}" for x in lines], [], [f"transactions_found={len(lines)}"])
    return SourceResult(url, "unverified", [], [f"{UNVERIFIED} {label} transactions not confirmed from available sources."], ["transactions_found=0"])


def parse_savant(html: str, url: str, label: str) -> SourceResult:
    m = re.search(r"(\d{1,2})-(\d{1,2})", text_from_html(html))
    if m:
        return SourceResult(url, "verified", [f"{label} Savant record signal: {m.group(1)}-{m.group(2)}"], [], ["record_pattern_matched=1"])
    return SourceResult(url, "unverified", [], [f"{UNVERIFIED} {label} Savant record signal not found."], ["record_pattern_matched=0"])


def build_snapshot() -> dict[str, Any]:
    session = build_session()
    source_health: dict[str, dict[str, Any]] = {}

    def run(key: str, parser: Callable[..., SourceResult], *args: str) -> SourceResult:
        html, error = fetch_html(session, URLS[key])
        if error:
            result = SourceResult(URLS[key], "source_error", [], [f"{UNVERIFIED} {key} unavailable."], [error])
        else:
            result = parser(html, URLS[key], *args)
        source_health[key] = asdict(result)
        return result

    lg_stand = run("league_standings", parse_standings)
    lg_prob = run("league_probables", parse_probables)
    lg_tx = run("league_transactions", parse_transactions, "League")

    teams: dict[str, Any] = {}
    for team in TEAM_KEYS:
        pretty = team.capitalize()
        t_stand = run(f"{team}_standings", parse_standings)
        t_prob = run(f"{team}_probables", parse_probables)
        t_mlb_tx = run(f"{team}_transactions", parse_transactions, pretty)
        t_espn_tx = run(f"{team}_espn_transactions", parse_transactions, f"{pretty} ESPN")
        t_savant = run(f"{team}_savant", parse_savant, pretty)

        teams[team] = {
            "headline": f"{pretty} source snapshot.",
            "emotion": "Measured",
            "verified_notes": t_stand.verified[:1] + t_prob.verified[:1] + t_mlb_tx.verified[:2] + t_espn_tx.verified[:2] + t_savant.verified[:1],
            "unverified_notes": t_stand.unverified + t_prob.unverified + t_mlb_tx.unverified + t_espn_tx.unverified + t_savant.unverified,
            "notes": ["Editorial framing only; do not promote UNVERIFIED entries as facts."],
            "checklist": ["Recheck sources before air.", "Promote only verified entries to on-air claims."],
            "source_status": {k: source_health[k]["status"] for k in [f"{team}_standings", f"{team}_probables", f"{team}_transactions", f"{team}_espn_transactions", f"{team}_savant"]},
            "debug": {k: source_health[k]["debug"] for k in [f"{team}_standings", f"{team}_probables", f"{team}_transactions", f"{team}_espn_transactions", f"{team}_savant"]},
        }

    now = datetime.now(timezone.utc)
    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "schema_version": "2.0",
        "sources": URLS,
        "source_status": {k: v["status"] for k, v in source_health.items()},
        "league": {
            "headline": "League snapshot from configured source lanes.",
            "verified_notes": lg_stand.verified[:5] + lg_prob.verified[:4],
            "unverified_notes": lg_stand.unverified + lg_prob.unverified,
            "stories": ["Use only verified league records/matchups/transactions for hard claims."],
            "watch": lg_prob.verified[:6] if lg_prob.verified else [f"{UNVERIFIED} No probable matchup entries parsed."],
            "transactions": lg_tx.verified if lg_tx.verified else lg_tx.unverified,
            "debug": {"standings": lg_stand.debug, "probables": lg_prob.debug, "transactions": lg_tx.debug},
        },
        "teams": teams,
        "debug": {"source_health": source_health, "generated_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ")},
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    snap = build_snapshot()
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    latest = DATA_DIR / "latest.json"
    dated = DATA_DIR / f"mlb_snapshot_{day}.json"
    latest.write_text(json.dumps(snap, indent=2), encoding="utf-8")
    dated.write_text(json.dumps(snap, indent=2), encoding="utf-8")
    logging.info("Wrote %s", latest)
    logging.info("Wrote %s", dated)


if __name__ == "__main__":
    main()
