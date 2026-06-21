import argparse
import json
import time
from pathlib import Path
from typing import Any


VALID_DECISIONS = {"pass", "reject", "review", "skip", "contacted", "favorite"}


def read_records(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Record a local recruiting decision without changing the website."
    )
    parser.add_argument("--key", required=True, help="Candidate key or stable ID.")
    parser.add_argument("--decision", required=True, choices=sorted(VALID_DECISIONS), help="Decision value.")
    parser.add_argument("--reason", default="", help="Short evidence-based reason.")
    parser.add_argument("--source", default="agent", help="Decision source label.")
    parser.add_argument("--url", default="", help="Optional page or candidate URL.")
    parser.add_argument("--evidence", action="append", default=[], help="Optional evidence file path. Can be repeated.")
    parser.add_argument("--records", default="runtime/artifacts/bossauto/decisions.json", help="Decision JSON path.")
    args = parser.parse_args()

    path = Path(args.records).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    records = read_records(path)
    records[args.key] = {
        "decision": args.decision,
        "reason": args.reason,
        "source": args.source,
        "url": args.url,
        "evidence": args.evidence,
        "ts": int(time.time()),
    }
    path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"records": str(path), "key": args.key, "entry": records[args.key]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
