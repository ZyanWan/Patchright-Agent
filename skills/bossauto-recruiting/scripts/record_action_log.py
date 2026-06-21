import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


VALID_ACTIONS = {
    "favorite",
    "collect",
    "contact_init",
    "greet",
    "contact",
    "open_continue_chat",
    "send_message",
    "exchange_contact",
    "mark_unsuitable",
}
VALID_STATUSES = {"planned", "performed", "skipped", "failed", "needs_review", "user_cancelled"}


def optional_hash(value: str) -> str:
    if not value:
        return ""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Append a local log entry for an approved BOSS website-changing action. "
            "This script only writes a log file and does not interact with BOSS."
        )
    )
    parser.add_argument("--key", required=True, help="Candidate key used for local records.")
    parser.add_argument("--action", required=True, choices=sorted(VALID_ACTIONS), help="Approved action type.")
    parser.add_argument("--status", required=True, choices=sorted(VALID_STATUSES), help="Action outcome.")
    parser.add_argument("--stable-id", default="", help="Optional BOSS stable ID.")
    parser.add_argument("--name", default="", help="Visible candidate name.")
    parser.add_argument("--authorization", default="", help="Short summary of the user approval.")
    parser.add_argument("--reason", default="", help="Evidence-based action reason.")
    parser.add_argument("--url", default="", help="Page or candidate URL.")
    parser.add_argument("--evidence", action="append", default=[], help="Evidence artifact path. Can be repeated.")
    parser.add_argument("--message-text", default="", help="Optional message text to hash, not store.")
    parser.add_argument("--error", default="", help="Error or skip reason.")
    parser.add_argument("--log", default="runtime/artifacts/bossauto/action-log.jsonl", help="Append-only JSONL log.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    path = Path(args.log).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    entry: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "candidateKey": args.key,
        "stableId": args.stable_id,
        "name": args.name,
        "action": args.action,
        "status": args.status,
        "authorization": args.authorization,
        "reason": args.reason,
        "evidenceArtifacts": args.evidence,
        "url": args.url,
        "messageTextHash": optional_hash(args.message_text),
        "error": args.error,
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"log": str(path), "entry": entry}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
