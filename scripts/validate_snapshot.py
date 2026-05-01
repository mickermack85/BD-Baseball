#!/usr/bin/env python3
"""Validate ``data/latest.json`` (or any snapshot) with content gates.

Modes:

- ``--lenient`` (default for legacy CI / smoke): schema-only checks.
- ``--strict``: require generated_at freshness, valid source_status values,
  at least one verified note per configured team, and a minimum number of
  verified league lanes.

Exit code 0 on success, non-zero with a clear message on failure.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REQUIRED_TOP_KEYS = [
    "generated_at",
    "schema_version",
    "sources",
    "source_status",
    "league",
    "teams",
    "debug",
]
REQUIRED_LEAGUE_KEYS = [
    "verified_notes",
    "unverified_notes",
    "transactions",
    "watch",
    "debug",
]
REQUIRED_TEAM_KEYS = [
    "verified_notes",
    "unverified_notes",
    "source_status",
    "debug",
]
DEFAULT_TEAMS = ["athletics", "rockies", "tigers"]
ALLOWED_SOURCE_STATUS = {"verified", "unverified", "source_error"}
SAMPLE_FIXTURE_MARKER = "UNVERIFIED: sample"


class ValidationError(Exception):
    pass


def _parse_iso(ts: str) -> datetime:
    # Accept Z suffix and +00:00.
    s = ts.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def validate(
    data: Any,
    *,
    strict: bool = False,
    teams: list[str] | None = None,
    max_age_minutes: int = 60 * 36,
    min_verified_lanes: int = 4,
    now: datetime | None = None,
) -> list[str]:
    """Return a list of validation problems. Empty list means OK."""
    teams = teams or DEFAULT_TEAMS
    now = now or datetime.now(timezone.utc)
    problems: list[str] = []

    if not isinstance(data, dict):
        return ["snapshot is not a JSON object"]

    for k in REQUIRED_TOP_KEYS:
        if k not in data:
            problems.append(f"missing top-level key: {k}")
    if problems:
        return problems

    league = data.get("league") or {}
    for k in REQUIRED_LEAGUE_KEYS:
        if k not in league:
            problems.append(f"league missing key: {k}")

    teams_block = data.get("teams") or {}
    for team in teams:
        if team not in teams_block:
            problems.append(f"missing team: {team}")
            continue
        for k in REQUIRED_TEAM_KEYS:
            if k not in teams_block[team]:
                problems.append(f"team {team} missing key: {k}")

    # source_status values must be from allowed set
    src_status = data.get("source_status") or {}
    if not isinstance(src_status, dict):
        problems.append("source_status is not an object")
    else:
        for k, v in src_status.items():
            if v not in ALLOWED_SOURCE_STATUS:
                problems.append(f"source_status[{k}] has invalid value: {v!r}")

    if not strict:
        return problems

    # ---- strict-only checks ----

    # generated_at freshness
    ts = data.get("generated_at")
    if not isinstance(ts, str) or not ts:
        problems.append("generated_at must be a non-empty ISO string in strict mode")
    else:
        try:
            gen = _parse_iso(ts)
        except ValueError as e:
            problems.append(f"generated_at not parseable as ISO timestamp: {e}")
        else:
            if gen.tzinfo is None:
                problems.append("generated_at must be timezone-aware in strict mode")
            else:
                age = now - gen
                age_minutes = age.total_seconds() / 60.0
                if age_minutes > max_age_minutes:
                    problems.append(
                        f"snapshot too stale: age={age_minutes:.0f}min > max={max_age_minutes}min"
                    )
                if age_minutes < -60:  # allow 1h clock skew
                    problems.append(
                        f"generated_at is in the future: {ts}"
                    )

    # Reject fixture/sample/all-empty snapshot
    league_unv = league.get("unverified_notes") or []
    if isinstance(league_unv, list) and any(
        isinstance(x, str) and SAMPLE_FIXTURE_MARKER in x for x in league_unv
    ):
        problems.append("snapshot still contains fixture marker 'UNVERIFIED: sample'")

    # Per-team: require >=1 verified note in strict mode
    for team in teams:
        block = teams_block.get(team) or {}
        verified = block.get("verified_notes") or []
        if not isinstance(verified, list) or len(verified) == 0:
            problems.append(f"team {team} has no verified_notes in strict mode")

    # Min verified lanes (any source_status entry == verified counts)
    verified_lane_count = sum(1 for v in src_status.values() if v == "verified") if isinstance(src_status, dict) else 0
    if verified_lane_count < min_verified_lanes:
        problems.append(
            f"only {verified_lane_count} verified source lanes; require >= {min_verified_lanes}"
        )

    return problems


def _main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--path", default="data/latest.json")
    p.add_argument("--strict", action="store_true")
    p.add_argument("--teams", default=",".join(DEFAULT_TEAMS))
    p.add_argument("--max-age-minutes", type=int, default=60 * 36)
    p.add_argument(
        "--min-verified-lanes",
        type=int,
        default=4,
        help="Minimum number of source lanes with status=verified (strict mode only).",
    )
    args = p.parse_args(argv)

    path = Path(args.path)
    if not path.exists():
        print(f"FAIL: {path} not found", file=sys.stderr)
        return 2

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"FAIL: {path} is not valid JSON: {e}", file=sys.stderr)
        return 2

    problems = validate(
        data,
        strict=args.strict,
        teams=[t.strip() for t in args.teams.split(",") if t.strip()],
        max_age_minutes=args.max_age_minutes,
        min_verified_lanes=args.min_verified_lanes,
    )
    if problems:
        print("FAIL: snapshot validation found issues:", file=sys.stderr)
        for x in problems:
            print(f"  - {x}", file=sys.stderr)
        return 1

    mode = "strict" if args.strict else "lenient"
    print(f"OK: snapshot validation passed ({mode}, path={path})")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
