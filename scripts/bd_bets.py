#!/usr/bin/env python3
"""BD Bets feed ingestion / normalization for BD Baseball snapshots.

The BD Bets feed is consumed as editorial/show-prep intelligence, NOT as a
sportsbook integration. The show generator reads picks and model notes for
on-air angles ("model lean", "watch the number") — never as wagering
instructions.

Feed contract (top-level JSON):
  - generated_at: ISO-8601 timestamp the feed was emitted
  - slate_date:   YYYY-MM-DD of the slate this feed covers
  - sport:        Must be "MLB" for now
  - source:       Optional string identifying the producer (default "bd_bets")
  - picks:        Array of pick objects (see below)
  - insights:     Optional array of editorial strings

Pick object:
  - game_id     (optional)  — stable identifier matching MLB Stats API gamePk
  - away_team   (required)
  - home_team   (required)
  - market      (required)  — moneyline | total | runline | ...
  - pick        (required)  — human-readable selection text
  - line        (optional)
  - odds        (optional)
  - confidence  (required)  — low | medium | high (or numeric 0..1)
  - edge        (optional)  — "+4.2%" or 0.042
  - model_note  (required for active picks)
  - status      (optional)  — open | win | loss | push | void (default open)
  - result      (optional)
  - source      (optional)

Resolution order for the snapshot builder:
  1. If --bd-bets-path / BD_BETS_PATH points to a file, read it.
  2. Else if --bd-bets-url / BD_BETS_URL is set, fetch it (no auth).
  3. Else omit the bd_bets section.
"""
from __future__ import annotations

from typing import Any, Callable
import json
import os

ALLOWED_STATUSES = {"open", "win", "loss", "push", "void"}
ALLOWED_CONFIDENCE_WORDS = {"low", "medium", "high"}


def _is_str(x: Any) -> bool:
    return isinstance(x, str) and x.strip() != ""


def _normalize_confidence(v: Any) -> str | None:
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ALLOWED_CONFIDENCE_WORDS:
            return s
        return s or None
    if isinstance(v, (int, float)):
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        if f >= 0.66:
            return "high"
        if f >= 0.33:
            return "medium"
        return "low"
    return None


def normalize_pick(raw: Any) -> dict[str, Any] | None:
    """Coerce a single raw pick into the snapshot's bd_bets pick shape.

    Returns None if required fields are missing — the caller decides whether
    to surface that as a soft warning or a hard validator failure.
    """
    if not isinstance(raw, dict):
        return None
    away = raw.get("away_team")
    home = raw.get("home_team")
    market = raw.get("market")
    pick = raw.get("pick")
    if not (_is_str(away) and _is_str(home) and _is_str(market) and _is_str(pick)):
        return None
    out: dict[str, Any] = {
        "game_id": raw.get("game_id") or "",
        "away_team": away.strip(),
        "home_team": home.strip(),
        "market": market.strip(),
        "pick": pick.strip(),
        "line": raw.get("line") or "",
        "odds": raw.get("odds") or "",
        "confidence": _normalize_confidence(raw.get("confidence")) or "",
        "edge": raw.get("edge") if raw.get("edge") not in (None, "") else "",
        "model_note": (raw.get("model_note") or "").strip(),
        "status": (raw.get("status") or "open").strip().lower(),
        "result": (raw.get("result") or "").strip(),
        "source": (raw.get("source") or "bd_bets").strip(),
    }
    if out["status"] not in ALLOWED_STATUSES:
        out["status"] = "open"
    return out


def normalize_feed(raw: Any) -> dict[str, Any]:
    """Normalize a parsed BD Bets feed payload into the snapshot section.

    The output always carries a `source_status` of either "verified",
    "unverified", or "source_error". Missing/empty feeds yield an empty
    section rather than a thrown exception so the rest of the snapshot
    keeps building.
    """
    if not isinstance(raw, dict):
        return {
            "generated_at": "",
            "slate_date": "",
            "sport": "MLB",
            "source": "bd_bets",
            "picks": [],
            "insights": [],
            "source_status": "source_error",
            "source_error": "feed payload was not a JSON object",
        }
    sport = (raw.get("sport") or "MLB").strip()
    raw_picks = raw.get("picks") or []
    picks: list[dict[str, Any]] = []
    dropped = 0
    for p in raw_picks:
        norm = normalize_pick(p)
        if norm is None:
            dropped += 1
            continue
        picks.append(norm)
    insights = [i.strip() for i in (raw.get("insights") or []) if _is_str(i)]
    status = "verified" if picks else "unverified"
    out: dict[str, Any] = {
        "generated_at": raw.get("generated_at") or "",
        "slate_date": raw.get("slate_date") or "",
        "sport": sport,
        "source": (raw.get("source") or "bd_bets").strip(),
        "picks": picks,
        "insights": insights,
        "source_status": status,
    }
    if dropped:
        out["dropped_picks"] = dropped
    return out


def load_from_path(path: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh), None
    except FileNotFoundError:
        return None, f"file_not_found: {path}"
    except json.JSONDecodeError as e:
        return None, f"json_decode_error: {e}"
    except OSError as e:
        return None, f"os_error: {e}"


def load_from_url(
    url: str,
    fetch: Callable[[str], tuple[Any | None, str | None]],
) -> tuple[dict[str, Any] | None, str | None]:
    payload, err = fetch(url)
    if err:
        return None, err
    if not isinstance(payload, dict):
        return None, "url_payload_not_dict"
    return payload, None


def resolve_feed(
    *,
    path: str | None = None,
    url: str | None = None,
    fetch: Callable[[str], tuple[Any | None, str | None]] | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    """Resolve and normalize the BD Bets feed, or return None if not configured.

    Resolution order: explicit path > explicit url > env BD_BETS_PATH > env
    BD_BETS_URL > None. Errors are surfaced via a populated `source_status`
    field in the returned section so the snapshot builder never crashes the
    whole run because the BD Bets feed was unavailable.
    """
    e = env if env is not None else os.environ
    chosen_path = path or e.get("BD_BETS_PATH") or ""
    chosen_url = url or e.get("BD_BETS_URL") or ""

    if chosen_path:
        raw, err = load_from_path(chosen_path)
        if err:
            return {
                "generated_at": "",
                "slate_date": "",
                "sport": "MLB",
                "source": "bd_bets",
                "picks": [],
                "insights": [],
                "source_status": "source_error",
                "source_error": err,
                "feed_path": chosen_path,
            }
        section = normalize_feed(raw)
        section["feed_path"] = chosen_path
        return section

    if chosen_url:
        if fetch is None:
            return {
                "generated_at": "",
                "slate_date": "",
                "sport": "MLB",
                "source": "bd_bets",
                "picks": [],
                "insights": [],
                "source_status": "source_error",
                "source_error": "no fetch function provided for URL feed",
                "feed_url": chosen_url,
            }
        raw, err = load_from_url(chosen_url, fetch)
        if err:
            return {
                "generated_at": "",
                "slate_date": "",
                "sport": "MLB",
                "source": "bd_bets",
                "picks": [],
                "insights": [],
                "source_status": "source_error",
                "source_error": err,
                "feed_url": chosen_url,
            }
        section = normalize_feed(raw)
        section["feed_url"] = chosen_url
        return section

    return None
