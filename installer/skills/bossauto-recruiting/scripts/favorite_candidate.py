import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from patchright.sync_api import sync_playwright


DEFAULT_URL = "https://www.zhipin.com/web/chat/recommend"
BOSS_HOSTS = {"www.zhipin.com"}
CARD_SELECTORS = [
    "div.candidate-card-wrap",
    "li.geek-info-card",
    "li.card-item div.candidate-card-wrap",
    "li.card-item",
    ".geek-item",
    ".candidate-card",
]


def parse_viewport(value: str) -> dict[str, int]:
    width, height = value.lower().replace(" ", "").split("x", 1)
    return {"width": int(width), "height": int(height)}


def safe_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return url[:800]
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query[:500], ""))[:800]


def is_boss_recruiting_url(url: str) -> bool:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    return parsed.scheme == "https" and parsed.netloc.lower() in BOSS_HOSTS and parsed.path.startswith("/web/chat/")


def preferred_frame_name(url: str) -> str | None:
    if "/web/chat/search" in url:
        return "searchFrame"
    if "/web/chat/recommend" in url:
        return "recommendFrame"
    return None


def ordered_frames(page) -> list[Any]:
    wanted = preferred_frame_name(page.url)
    frames = page.frames
    if wanted:
        preferred = [frame for frame in frames if frame.name == wanted]
        frames = preferred + [frame for frame in frames if frame.name != wanted]
    return frames


def visible_box(locator):
    try:
        box = locator.bounding_box()
    except Exception:
        return None
    if box and box["width"] > 8 and box["height"] > 8:
        return box
    return None


def card_stable_id(card) -> str:
    return card.evaluate(
        """(c) =>
            c.getAttribute('data-geek') ||
            c.getAttribute('data-geekid') ||
            c.getAttribute('data-lid') ||
            c.querySelector('[data-geek]')?.getAttribute('data-geek') ||
            c.querySelector('[data-geekid]')?.getAttribute('data-geekid') ||
            c.querySelector('[data-lid]')?.getAttribute('data-lid') ||
            ''
        """
    )


def card_summary(card) -> dict[str, str]:
    return card.evaluate(
        """(c) => {
            const text = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
            const stableId =
                c.getAttribute('data-geek') ||
                c.getAttribute('data-geekid') ||
                c.getAttribute('data-lid') ||
                c.querySelector('[data-geek]')?.getAttribute('data-geek') ||
                c.querySelector('[data-geekid]')?.getAttribute('data-geekid') ||
                c.querySelector('[data-lid]')?.getAttribute('data-lid') ||
                '';
            const nameEl =
                c.querySelector('.name-label') ||
                c.querySelector('span.name') ||
                c.querySelector('.geek-name') ||
                c.querySelector('.row.name-wrap') ||
                c.querySelector('[class*="name"]');
            return { stableId, name: text(nameEl), text: text(c) };
        }"""
    )


def card_text(card) -> str:
    return card.evaluate("(c) => (c.textContent || '').replace(/\\s+/g, ' ').trim()")


def wait_for_cards(page, timeout_ms: int) -> None:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        for frame in ordered_frames(page):
            for selector in CARD_SELECTORS:
                loc = frame.locator(selector)
                for i in range(min(loc.count(), 20)):
                    if visible_box(loc.nth(i)):
                        return
        page.wait_for_timeout(250)


def pick_card(page, stable_id: str, candidate_name: str):
    for frame in ordered_frames(page):
        for selector in CARD_SELECTORS:
            loc = frame.locator(selector)
            found_visible = False
            for i in range(loc.count()):
                card = loc.nth(i)
                if not visible_box(card):
                    continue
                found_visible = True
                summary = card_summary(card)
                if summary["stableId"] != stable_id:
                    continue
                text = summary["text"] or card_text(card)
                if candidate_name and candidate_name not in text:
                    raise SystemExit("Matched stable ID but card text does not contain expected candidate name.")
                return frame, card, summary
            if found_visible:
                break
    return None, None, ""


def click_card(card) -> None:
    for selector in [".name-label", "span.name", ".geek-name", "[class*='name']", ".row.name-wrap"]:
        target = card.locator(selector).first
        if target.count() > 0 and visible_box(target):
            target.click(timeout=3000)
            return
    card.click(timeout=3000)


def find_text_target(page, labels: list[str]):
    matches = []
    for frame in page.frames:
        for label in labels:
            loc = frame.get_by_text(label, exact=True)
            for i in range(loc.count()):
                item = loc.nth(i)
                box = visible_box(item)
                if not box:
                    continue
                matches.append({"frame": frame, "locator": item, "label": label, "box": box})
    matches.sort(key=lambda item: (item["box"]["x"], item["box"]["y"]))
    return matches[0] if matches else None


def append_action_log(path: Path, entry: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")


def read_records(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def write_decision(path: Path, key: str, decision: str, reason: str, source: str, url: str, evidence: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    records = read_records(path)
    records[key] = {
        "decision": decision,
        "reason": reason,
        "source": source,
        "url": url,
        "evidence": evidence,
        "ts": int(time.time()),
    }
    path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")


def log_apply_result(args: argparse.Namespace, result: dict[str, Any]) -> None:
    if not args.apply:
        return
    evidence = [value for value in [args.screenshot_before, args.screenshot_after] if value]
    url = result.get("urlAfterOpen") or result.get("urlBefore") or ""
    candidate_key = f"id:{args.stable_id}"
    log_status = "skipped" if result["status"] == "already_favorite" else result["status"]
    append_action_log(
        Path(args.action_log).expanduser().resolve(),
        {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "candidateKey": candidate_key,
            "stableId": args.stable_id,
            "name": result.get("matchedName") or args.candidate_name,
            "action": "favorite",
            "status": log_status,
            "authorization": args.authorization,
            "reason": result["reason"],
            "evidenceArtifacts": evidence,
            "url": url,
            "messageTextHash": "",
            "error": "" if log_status in {"performed", "skipped", "planned"} else result["reason"],
        },
    )
    decision = "favorite" if result["status"] in {"performed", "already_favorite"} else "review"
    write_decision(
        Path(args.decisions).expanduser().resolve(),
        candidate_key,
        decision,
        result["reason"],
        "bossauto-favorite",
        url,
        evidence,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Favorite one explicitly approved BOSS candidate by stable ID. "
            "Defaults to dry-run; use --apply to click."
        )
    )
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--profile", default="runtime/profiles/bossauto-profile")
    parser.add_argument("--stable-id", required=True, help="Approved target BOSS stable ID.")
    parser.add_argument("--candidate-name", default="")
    parser.add_argument("--json", default="runtime/artifacts/bossauto/favorite-result.json")
    parser.add_argument("--action-log", default="runtime/artifacts/bossauto/action-log.jsonl")
    parser.add_argument("--decisions", default="runtime/artifacts/bossauto/decisions.json")
    parser.add_argument("--authorization", default="", help="Short current-user approval summary; required with --apply.")
    parser.add_argument("--screenshot-before", default="")
    parser.add_argument("--screenshot-after", default="")
    parser.add_argument("--executable")
    parser.add_argument("--channel")
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--timezone", default="Asia/Shanghai")
    parser.add_argument("--viewport", default="1366x768")
    parser.add_argument("--wait-ms", type=int, default=8000)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--headless", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.apply and not args.authorization:
        raise SystemExit("--authorization is required when --apply is supplied.")
    profile = Path(args.profile).expanduser().resolve()
    output_json = Path(args.json).expanduser().resolve()
    output_json.parent.mkdir(parents=True, exist_ok=True)
    before_path = Path(args.screenshot_before).expanduser().resolve() if args.screenshot_before else None
    after_path = Path(args.screenshot_after).expanduser().resolve() if args.screenshot_after else None
    if before_path:
        before_path.parent.mkdir(parents=True, exist_ok=True)
    if after_path:
        after_path.parent.mkdir(parents=True, exist_ok=True)

    launch_options: dict[str, Any] = {
        "user_data_dir": str(profile),
        "headless": args.headless,
        "locale": args.locale,
        "timezone_id": args.timezone,
        "viewport": parse_viewport(args.viewport),
    }
    if args.executable:
        launch_options["executable_path"] = str(Path(args.executable).expanduser().resolve())
    if args.channel:
        launch_options["channel"] = args.channel

    result: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "requested": {
            "stableId": args.stable_id,
            "candidateName": args.candidate_name,
            "apply": args.apply,
        },
        "status": "failed",
        "reason": "",
    }

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(**launch_options)
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=45000)
        wait_for_cards(page, args.wait_ms)
        if args.apply and not is_boss_recruiting_url(page.url):
            context.close()
            raise SystemExit(f"--apply refused because the active page is not a BOSS recruiting page: {safe_url(page.url)}")
        frame, card, summary = pick_card(page, args.stable_id, args.candidate_name)
        matched_text = summary["text"] if summary else ""
        result["urlBefore"] = page.url
        result["title"] = page.title()
        result["sourceFrame"] = {"name": frame.name, "url": frame.url} if frame else None
        result["matchedStableId"] = summary["stableId"] if summary else ""
        result["matchedName"] = summary["name"] if summary else ""
        result["matchedCardText"] = matched_text[:1000]
        if card is None:
            result["reason"] = "target stable ID is not visible"
            log_apply_result(args, result)
            output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            context.close()
            return 1

        click_card(card)
        page.wait_for_timeout(args.wait_ms)
        if before_path:
            page.screenshot(path=str(before_path), full_page=True)

        already = find_text_target(page, ["已收藏", "取消收藏"])
        favorite = find_text_target(page, ["收藏"])
        result["urlAfterOpen"] = page.url
        result["alreadyFavoriteVisible"] = bool(already)
        result["favoriteVisible"] = bool(favorite)
        result["favoriteBox"] = favorite["box"] if favorite else None
        if already:
            result["status"] = "already_favorite"
            result["reason"] = f"visible label: {already['label']}"
        elif not favorite:
            result["status"] = "failed"
            result["reason"] = "favorite label is not visible after opening candidate detail"
        elif args.apply:
            favorite["locator"].click(timeout=3000)
            page.wait_for_timeout(1500)
            result["status"] = "performed"
            result["reason"] = "clicked visible favorite label"
        else:
            result["status"] = "planned"
            result["reason"] = "dry-run found visible favorite label"

        if after_path:
            page.screenshot(path=str(after_path), full_page=True)
        log_apply_result(args, result)
        output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        context.close()
    return 0 if result["status"] in {"planned", "performed", "already_favorite"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
