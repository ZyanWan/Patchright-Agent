import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CONTACTED_RE = re.compile(r"已沟通|沟通记录|继续沟通|已打招呼|已联系|已交换|聊过")


def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).expanduser().resolve().read_text(encoding="utf-8-sig"))


def contains_any(text: str, keywords: list[str]) -> str:
    for keyword in keywords:
        if keyword and keyword in text:
            return keyword
    return ""


def candidate_text(candidate: dict[str, Any], *fields: str) -> str:
    return "\n".join(str(candidate.get(field) or "") for field in fields)


def decide(candidate: dict[str, Any], criteria: dict[str, Any]) -> dict[str, Any]:
    hard = criteria.get("hard") or {}
    text = candidate_text(candidate, "text", "companyText", "titleText", "educationText")
    company = candidate_text(candidate, "companyText")
    title = candidate_text(candidate, "titleText")
    education = candidate_text(candidate, "educationText")

    if hard.get("skip_contacted", True) and (candidate.get("contactedLikely") or CONTACTED_RE.search(text)):
        return {"decision": "skip", "stage": "list", "reason": "visible contacted/chat signal"}

    hit = contains_any(company, hard.get("forbid_company_keywords") or [])
    if hit:
        return {"decision": "reject", "stage": "company", "reason": f"company keyword blocked: {hit}"}

    hit = contains_any(title, hard.get("title_block_keywords") or [])
    if hit:
        return {"decision": "reject", "stage": "title", "reason": f"title keyword blocked: {hit}"}

    required_education = hard.get("education_required_any") or []
    if required_education and education and not contains_any(education, required_education):
        return {
            "decision": "reject",
            "stage": "education",
            "reason": f"education does not contain any required value: {required_education}",
        }

    allow_company = contains_any(company, hard.get("allow_company_keywords") or [])
    allow_title = contains_any(title, hard.get("title_allow_keywords") or [])
    if allow_company or allow_title:
        reasons = []
        if allow_company:
            reasons.append(f"company allow keyword: {allow_company}")
        if allow_title:
            reasons.append(f"title allow keyword: {allow_title}")
        return {"decision": "pass", "stage": "list", "reason": "; ".join(reasons)}

    return {"decision": "review", "stage": "list", "reason": "no deterministic reject or pass evidence"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply deterministic local criteria to scan_candidates.py JSON without touching the website."
    )
    parser.add_argument("--candidates", required=True, help="JSON output from scan_candidates.py.")
    parser.add_argument("--criteria", required=True, help="Workspace-local criteria JSON file.")
    parser.add_argument("--json", default="runtime/artifacts/bossauto/dry-run-decisions.json", help="Output JSON path.")
    parser.add_argument("--limit", type=int, default=0, help="Optional max candidates to evaluate.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    scan = load_json(args.candidates)
    criteria = load_json(args.criteria)
    output_json = Path(args.json).expanduser().resolve()
    output_json.parent.mkdir(parents=True, exist_ok=True)
    candidates = scan.get("candidates") or []
    if args.limit > 0:
        candidates = candidates[: args.limit]

    decisions = []
    summary = {"pass": 0, "reject": 0, "review": 0, "skip": 0}
    for candidate in candidates:
        decision = decide(candidate, criteria)
        summary[decision["decision"]] = summary.get(decision["decision"], 0) + 1
        decisions.append(
            {
                "key": candidate.get("key"),
                "stableId": candidate.get("stableId"),
                "name": candidate.get("name"),
                "index": candidate.get("index"),
                **decision,
            }
        )

    result = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": str(Path(args.candidates).expanduser().resolve()),
        "criteria": str(Path(args.criteria).expanduser().resolve()),
        "candidateCount": len(candidates),
        "summary": summary,
        "decisions": decisions,
    }
    output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
