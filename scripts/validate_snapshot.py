#!/usr/bin/env python3
import json
from pathlib import Path

path = Path("data/latest.json")
if not path.exists():
    raise SystemExit("data/latest.json not found")

data = json.loads(path.read_text(encoding="utf-8"))
required_top = ["generated_at", "schema_version", "sources", "source_status", "league", "teams", "debug"]
missing = [k for k in required_top if k not in data]
if missing:
    raise SystemExit(f"Missing top-level keys: {missing}")

for part in ["verified_notes", "unverified_notes", "transactions", "watch", "debug"]:
    if part not in data["league"]:
        raise SystemExit(f"league missing {part}")

for team in ["athletics", "rockies", "tigers"]:
    if team not in data["teams"]:
        raise SystemExit(f"Missing team: {team}")
    for key in ["verified_notes", "unverified_notes", "source_status", "debug"]:
        if key not in data["teams"][team]:
            raise SystemExit(f"{team} missing {key}")

print("snapshot schema check passed")
