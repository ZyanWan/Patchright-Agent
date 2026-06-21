import argparse
import json
import re
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
DETAIL_CONTAINER_SELECTORS = [
    ".resume-item-detail",
    ".resume-simple-box",
    ".resume-right-side",
    ".resume-detail-wrap",
    "[class*='resume-detail']",
    "[class*='candidate-detail']",
    "[class*='geek-info-page']",
    ".geek-detail",
    ".candidate-detail",
    ".resume-detail",
    ".resume-layout-wrap",
]
CONTACT_INIT_SELECTORS = [
    'button:has-text("沟通")',
    'a:has-text("沟通")',
    '[role="button"]:has-text("沟通")',
    '.button-chat-wrap.resumeGreet button.btn-greet',
    ".button-chat-wrap.resumeGreet",
    "button.btn-greet",
    ".btn-greet",
    "div.chat-button-wrap",
    "div.button-chat-wrap",
    'button:has-text("打招呼")',
    'button:has-text("立即沟通")',
    'a:has-text("打招呼")',
]
CONTACTED_RE = re.compile(r"已沟通|沟通记录|继续沟通|已打招呼|已联系|已交换|聊过")
POST_CLICK_SUCCESS_RE = re.compile(r"已沟通|沟通记录|继续沟通|已打招呼|已联系|聊过")
STOP_RE = re.compile(r"验证码|安全验证|登录|付费|购买|开通|额度|限制|异常|认证|确认|风险|申诉")


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


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def preferred_frame_name(url: str) -> str | None:
    if "/web/chat/search" in url:
        return "searchFrame"
    if "/web/chat/recommend" in url:
        return "recommendFrame"
    if "/web/chat/interaction" in url:
        return "interactionFrame"
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
                c.querySelector('[class*="name"]') ||
                c.querySelector('h3, h4, strong');
            return { stableId, name: text(nameEl), text: text(c) };
        }"""
    )


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
            seen_stable_ids: set[str] = set()
            for i in range(loc.count()):
                card = loc.nth(i)
                if not visible_box(card):
                    continue
                found_visible = True
                summary = card_summary(card)
                stable = summary.get("stableId") or ""
                if stable and stable in seen_stable_ids:
                    continue
                if stable:
                    seen_stable_ids.add(stable)
                if stable != stable_id:
                    continue
                text = summary.get("text") or ""
                if candidate_name and candidate_name not in text:
                    raise SystemExit("Matched stable ID but card text does not contain expected candidate name.")
                return frame, card, summary
            if found_visible:
                break
    return None, None, {}


def click_card(card) -> None:
    for selector in [".name-label", "span.name", ".geek-name", "[class*='name']", ".row.name-wrap", "h3", "h4"]:
        target = card.locator(selector).first
        if target.count() > 0 and visible_box(target):
            target.click(timeout=3000)
            return
    card.click(timeout=3000)


def find_contact_button(scope):
    for selector in CONTACT_INIT_SELECTORS:
        loc = scope.locator(selector)
        for i in range(loc.count()):
            button = loc.nth(i)
            box = visible_box(button)
            if not box:
                continue
            text = clean(button.inner_text(timeout=1000))
            if "继续沟通" in text:
                continue
            if any(label in text for label in ["沟通", "打招呼", "立即沟通"]) or selector.startswith(".") or selector.startswith("div."):
                return button, selector, text, box
    return None, "", "", None


def find_detail_container(page):
    contexts: list[tuple[Any, str]] = [(page, "page")]
    contexts.extend((frame, f"frame:{frame.name or safe_url(frame.url)}") for frame in page.frames)
    for ctx, where in contexts:
        for selector in DETAIL_CONTAINER_SELECTORS:
            loc = ctx.locator(selector)
            for i in range(loc.count()):
                item = loc.nth(i)
                box = visible_box(item)
                if box and box["width"] > 200 and box["height"] > 160:
                    return item, selector, where
    return None, "", ""


def visible_text(page) -> str:
    try:
        return clean(page.locator("body").inner_text(timeout=5000))
    except Exception:
        return ""


def confirm_contact_state(page, stable_id: str, candidate_name: str) -> tuple[bool, str]:
    _, card, summary = pick_card(page, stable_id, candidate_name)
    if card is not None:
        card_text = summary.get("text") or ""
        if CONTACTED_RE.search(card_text):
            return True, "target candidate card shows contacted/continue-chat state"

    detail, _, _ = find_detail_container(page)
    if detail is not None:
        detail_text = clean(detail.inner_text(timeout=5000))
        if candidate_name in detail_text and POST_CLICK_SUCCESS_RE.search(detail_text):
            return True, "target candidate detail shows contacted state"

    chat_selectors = [
        "[class*='chatview']",
        "[class*='chat-view']",
        "[class*='chat']",
        "[class*='message']",
        "[class*='conversation']",
    ]
    contexts: list[Any] = [page, *page.frames]
    for ctx in contexts:
        for selector in chat_selectors:
            loc = ctx.locator(selector)
            for i in range(min(loc.count(), 30)):
                item = loc.nth(i)
                box = visible_box(item)
                if not box or box["width"] < 160 or box["height"] < 80:
                    continue
                text = clean(item.inner_text(timeout=1000))
                if candidate_name in text and any(signal in text for signal in ["发送", "沟通职位", "送达", "常用语"]):
                    return True, "matching chat panel opened for target candidate"
    return False, "contacted state was not confirmed on target card/detail/chat panel"


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
    url = result.get("urlAfterClick") or result.get("urlBeforeClick") or result.get("urlBefore") or ""
    candidate_key = f"id:{args.stable_id}"
    append_action_log(
        Path(args.action_log).expanduser().resolve(),
        {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "candidateKey": candidate_key,
            "stableId": args.stable_id,
            "name": args.candidate_name,
            "action": "contact_init",
            "status": result["status"],
            "authorization": args.authorization,
            "reason": result["reason"],
            "evidenceArtifacts": evidence,
            "url": url,
            "messageTextHash": "",
            "error": "" if result["status"] in {"performed", "skipped", "planned"} else result["reason"],
        },
    )
    decision = "contacted" if result["status"] == "performed" else "skip" if result["status"] == "skipped" else "review"
    write_decision(
        Path(args.decisions).expanduser().resolve(),
        candidate_key,
        decision,
        result["reason"] + " Only the initial contact button was automated; any greeting was platform-preconfigured.",
        "bossauto-contact",
        url,
        evidence,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Initiate contact for one explicitly approved BOSS candidate by stable ID. "
            "Defaults to dry-run; use --apply to click. Does not type, edit, or manually send chat messages. "
            "The platform may auto-send a preset greeting after the click."
        )
    )
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--profile", default="runtime/profiles/bossauto-profile")
    parser.add_argument("--stable-id", required=True, help="Approved target BOSS stable ID.")
    parser.add_argument("--candidate-name", required=True, help="Visible candidate name for identity verification.")
    parser.add_argument("--json", default="runtime/artifacts/bossauto/contact-result.json")
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
            "action": "contact_init",
        },
        "status": "failed",
        "reason": "",
        "warning": (
            "This script does not type, edit, or manually send chat messages. "
            "The platform may auto-send a recruiter's preset greeting after the approved click."
        ),
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
        result["urlBefore"] = safe_url(page.url)
        result["title"] = page.title()
        result["frames"] = [{"name": item.name, "url": safe_url(item.url)} for item in page.frames]
        result["sourceFrame"] = {"name": frame.name, "url": safe_url(frame.url)} if frame else None
        result["matchedStableId"] = summary.get("stableId", "")
        result["matchedName"] = summary.get("name", "")
        result["matchedCardText"] = (summary.get("text") or "")[:1500]
        if card is None:
            result["reason"] = "target stable ID is not visible"
            output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            context.close()
            return 1

        card_text = summary.get("text") or ""
        if CONTACTED_RE.search(card_text):
            result["status"] = "skipped"
            result["reason"] = "candidate card already shows contacted/continue-chat signal"
            if before_path:
                page.screenshot(path=str(before_path), full_page=True)
            log_apply_result(args, result)
            output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            context.close()
            return 0

        button, selector, button_text, button_box = find_contact_button(card)
        result["buttonSource"] = "card" if button else ""

        if button is None:
            click_card(card)
            page.wait_for_timeout(args.wait_ms)
            detail, detail_selector, detail_where = find_detail_container(page)
            result["detailContainer"] = {"selector": detail_selector, "where": detail_where} if detail else None
            if detail is not None:
                detail_text = clean(detail.inner_text(timeout=5000))
                result["detailTextSample"] = detail_text[:1500]
                if args.candidate_name and args.candidate_name not in detail_text and args.candidate_name not in card_text:
                    result["status"] = "failed"
                    result["reason"] = "detail/card text does not verify candidate name"
                    log_apply_result(args, result)
                    output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                    print(json.dumps(result, ensure_ascii=False, indent=2))
                    context.close()
                    return 1
                if CONTACTED_RE.search(detail_text):
                    result["status"] = "skipped"
                    result["reason"] = "candidate detail already shows contacted/continue-chat signal"
                    if before_path:
                        page.screenshot(path=str(before_path), full_page=True)
                    log_apply_result(args, result)
                    output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                    print(json.dumps(result, ensure_ascii=False, indent=2))
                    context.close()
                    return 0
                button, selector, button_text, button_box = find_contact_button(detail)
                result["buttonSource"] = "detail" if button else ""

        result["urlBeforeClick"] = safe_url(page.url)
        result["buttonSelector"] = selector
        result["buttonText"] = button_text
        result["buttonBox"] = button_box
        if before_path:
            page.screenshot(path=str(before_path), full_page=True)

        if button is None:
            result["status"] = "failed"
            result["reason"] = "scoped contact-initiation button is not visible"
        elif not args.apply:
            result["status"] = "planned"
            result["reason"] = "dry-run found scoped contact-initiation button"
        else:
            button.click(timeout=5000)
            page.wait_for_timeout(2500)
            body_text = visible_text(page)
            result["urlAfterClick"] = safe_url(page.url)
            result["postClickTextSample"] = body_text[:3000]
            confirmed, confirm_reason = confirm_contact_state(page, args.stable_id, args.candidate_name)
            result["confirmationReason"] = confirm_reason
            if confirmed:
                result["status"] = "performed"
                result["reason"] = "clicked scoped contact-initiation button and confirmed target contacted state"
            elif STOP_RE.search(body_text):
                result["status"] = "needs_review"
                result["reason"] = "post-click page contains a stop/review signal"
            else:
                result["status"] = "needs_review"
                result["reason"] = "clicked button but target contacted state was not confirmed"

        if after_path:
            page.screenshot(path=str(after_path), full_page=True)
        log_apply_result(args, result)
        output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        context.close()

    return 0 if result["status"] in {"planned", "performed", "skipped", "needs_review"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
