import argparse
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from patchright.sync_api import sync_playwright


DEFAULT_URL = "https://www.zhipin.com/web/chat/interaction"
BOSS_HOSTS = {"www.zhipin.com"}
DEFAULT_URL_HELP = (
    "BOSS page to use when opening a browser. For --candidates JSON, the scan source URL is used "
    "when available. Pass --url explicitly for approved sources, especially before --apply."
)
CARD_SELECTORS = [
    "li.geek-info-card",
    "div.candidate-card-wrap",
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
    ".button-chat-wrap.resumeGreet button.btn-greet",
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


def short_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def candidate_key(item: dict[str, Any]) -> str:
    stable_id = clean(str(item.get("stableId") or ""))
    if stable_id:
        return f"id:{stable_id}"
    name = clean(str(item.get("name") or "unknown"))
    text = clean(str(item.get("text") or item.get("cardText") or ""))
    return f"text:{name}:{short_hash(text)}"


def safe_slug(value: str) -> str:
    slug = re.sub(r"[^\w\u4e00-\u9fff.-]+", "-", value, flags=re.UNICODE).strip("-._")
    return (slug or "candidate")[:60]


def preferred_frame_name(url: str) -> str | None:
    if "/web/chat/search" in url:
        return "searchFrame"
    if "/web/chat/recommend" in url:
        return "recommendFrame"
    if "/web/chat/interaction" in url:
        return "interactionFrame"
    return None


def page_type(url: str) -> str:
    if "/web/chat/search" in url:
        return "search"
    if "/web/chat/recommend" in url:
        return "recommendation"
    if "/web/chat/interaction" in url:
        return "interaction"
    if "/web/chat/" in url:
        return "chat"
    if "zhipin.com" in url:
        return "boss"
    return "other"


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
                if stable_id and stable != stable_id:
                    continue
                text = summary.get("text") or ""
                if candidate_name and candidate_name not in text:
                    continue
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


def normalize_candidate(raw: dict[str, Any], index: int) -> dict[str, Any]:
    item = dict(raw)
    item["stableId"] = clean(str(raw.get("stableId") or raw.get("stable_id") or ""))
    item["name"] = clean(str(raw.get("name") or raw.get("candidateName") or raw.get("candidate_name") or ""))
    item["text"] = clean(str(raw.get("text") or raw.get("cardText") or ""))
    item["key"] = clean(str(raw.get("key") or candidate_key(item)))
    item["sourceIndex"] = raw.get("index", index)
    item["contactedLikely"] = bool(raw.get("contactedLikely")) or bool(CONTACTED_RE.search(item["text"]))
    return item


def load_targets(args: argparse.Namespace) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if bool(args.candidates) == bool(args.targets_json):
        raise SystemExit("Provide exactly one of --candidates or --targets-json.")

    source_path = Path(args.targets_json or args.candidates).expanduser().resolve()
    data = json.loads(source_path.read_text(encoding="utf-8-sig"))
    source_meta: dict[str, Any] = {
        "path": str(source_path),
        "kind": "targets-json" if args.targets_json else "candidates",
        "url": "",
        "pageType": "",
    }
    if isinstance(data, dict):
        source_meta["url"] = clean(str(data.get("url") or data.get("sourceUrl") or ""))
        source_meta["pageType"] = clean(str(data.get("pageType") or data.get("sourcePageType") or ""))
        raw_items = data.get("targets") if args.targets_json else data.get("candidates")
        if raw_items is None:
            raw_items = data.get("items") or data.get("results")
    else:
        raw_items = data
    if not isinstance(raw_items, list):
        raise SystemExit(f"{source_path} must contain a list, or a JSON object with candidates/targets.")

    targets: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_items, start=1):
        if not isinstance(raw, dict):
            continue
        item = normalize_candidate(raw, index)
        identity = item["stableId"] or item["key"]
        if not identity or identity in seen:
            continue
        seen.add(identity)
        if not item["stableId"]:
            item["skipReason"] = "missing stable ID"
            targets.append(item)
            continue
        if args.candidates and item["contactedLikely"] and not args.include_contacted:
            continue
        if args.name_contains and args.name_contains not in item["name"]:
            continue
        targets.append(item)
        if args.limit and len([target for target in targets if not target.get("skipReason")]) >= args.limit:
            break
    return targets, source_meta


def resolve_source_url(args: argparse.Namespace, source_meta: dict[str, Any]) -> tuple[str, str, list[str]]:
    explicit_url = bool(args.url)
    requested_url = args.url or DEFAULT_URL
    scan_url = clean(str(source_meta.get("url") or ""))
    warnings: list[str] = []

    if args.candidates and scan_url and not explicit_url:
        return scan_url, "candidates-json", warnings
    if explicit_url:
        if scan_url and page_type(scan_url) != "other" and page_type(requested_url) != "other":
            scan_type = page_type(scan_url)
            arg_type = page_type(requested_url)
            if scan_type != arg_type:
                warnings.append(
                    f"explicit URL page type ({arg_type}) differs from candidate scan source ({scan_type})"
                )
        return requested_url, "explicit-url", warnings
    return requested_url, "default-url", warnings


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


def scan_visible_candidates(page) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
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
                text = summary.get("text") or ""
                stable_id = summary.get("stableId") or ""
                key = f"id:{stable_id}" if stable_id else f"text:{short_hash(text)}"
                if key in seen:
                    continue
                seen.add(key)
                candidates.append(
                    {
                        "index": len(candidates) + 1,
                        "key": key,
                        "stableId": stable_id,
                        "name": summary.get("name") or "",
                        "frameName": frame.name,
                        "selector": selector,
                        "contactedLikely": bool(CONTACTED_RE.search(text)),
                        "text": text,
                    }
                )
            if found_visible:
                break
    return candidates


def screenshot_path(out_dir: Path, index: int, target: dict[str, Any], stage: str) -> Path:
    name = safe_slug(target.get("name") or target.get("key") or str(index))
    return out_dir / f"{index:03d}-{name}-{stage}.png"


def process_target(page, target: dict[str, Any], args: argparse.Namespace, out_dir: Path, index: int) -> dict[str, Any]:
    stable_id = target["stableId"]
    candidate_name = target["name"]
    key = target["key"]
    result: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "candidateKey": key,
        "stableId": stable_id,
        "name": candidate_name,
        "sourceIndex": target.get("sourceIndex"),
        "action": "contact_init",
        "apply": args.apply,
        "status": "failed",
        "reason": "",
        "warning": (
            "This script does not type, edit, or manually send chat messages. "
            "The platform may auto-send a recruiter's preset greeting after the approved click."
        ),
    }

    if target.get("skipReason"):
        result["status"] = "skipped"
        result["reason"] = target["skipReason"]
        return result

    frame, card, summary = pick_card(page, stable_id, candidate_name)
    result["urlBefore"] = safe_url(page.url)
    result["sourceFrame"] = {"name": frame.name, "url": safe_url(frame.url)} if frame else None
    result["matchedStableId"] = summary.get("stableId", "")
    result["matchedName"] = summary.get("name", "")
    result["matchedCardText"] = (summary.get("text") or "")[:1500]
    if card is None:
        result["status"] = "failed"
        result["reason"] = "target stable ID and name are not visible"
        return result

    card_text = summary.get("text") or ""
    if CONTACTED_RE.search(card_text):
        result["status"] = "skipped"
        result["reason"] = "candidate card already shows contacted/continue-chat signal"
        return result

    if args.screenshots:
        before = screenshot_path(out_dir, index, target, "before")
        page.screenshot(path=str(before), full_page=True)
        result["screenshotBefore"] = str(before)

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
            if candidate_name and candidate_name not in detail_text and candidate_name not in card_text:
                result["status"] = "failed"
                result["reason"] = "detail/card text does not verify candidate name"
                return result
            if CONTACTED_RE.search(detail_text):
                result["status"] = "skipped"
                result["reason"] = "candidate detail already shows contacted/continue-chat signal"
                return result
            button, selector, button_text, button_box = find_contact_button(detail)
            result["buttonSource"] = "detail" if button else ""

    result["urlBeforeClick"] = safe_url(page.url)
    result["buttonSelector"] = selector
    result["buttonText"] = button_text
    result["buttonBox"] = button_box

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
        confirmed, confirm_reason = confirm_contact_state(page, stable_id, candidate_name)
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

    if args.screenshots:
        after = screenshot_path(out_dir, index, target, "after")
        page.screenshot(path=str(after), full_page=True)
        result["screenshotAfter"] = str(after)
    return result


def log_result(args: argparse.Namespace, result: dict[str, Any], action_log: Path, decisions: Path) -> None:
    evidence = [value for value in [result.get("screenshotBefore"), result.get("screenshotAfter")] if value]
    if args.apply:
        append_action_log(
            action_log,
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "candidateKey": result["candidateKey"],
                "stableId": result["stableId"],
                "name": result["name"],
                "action": "contact_init",
                "status": result["status"],
                "authorization": args.authorization,
                "reason": result["reason"],
                "evidenceArtifacts": evidence,
                "url": result.get("urlAfterClick") or result.get("urlBeforeClick") or result.get("urlBefore") or "",
                "messageTextHash": "",
                "error": "" if result["status"] in {"performed", "skipped", "planned"} else result["reason"],
            },
        )
        decision = "contacted" if result["status"] == "performed" else "skip" if result["status"] == "skipped" else "review"
        write_decision(
            decisions,
            result["candidateKey"],
            decision,
            (
                result["reason"]
                + " Only the initial contact button was automated; any greeting was platform-preconfigured."
            ),
            "bossauto-batch-contact",
            result.get("urlAfterClick") or result.get("urlBeforeClick") or result.get("urlBefore") or "",
            evidence,
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Batch-initiate contact for approved BOSS candidates. "
            "Defaults to dry-run; use --apply with --authorization to click. "
            "Does not type, edit, or manually send chat messages."
        )
    )
    parser.add_argument("--url", default=None, help=DEFAULT_URL_HELP)
    parser.add_argument("--profile", default="runtime/profiles/bossauto-profile")
    parser.add_argument("--candidates", help="Scan JSON from scan_candidates.py; uncontacted candidates become targets.")
    parser.add_argument("--targets-json", help="Explicit approved target list JSON.")
    parser.add_argument("--json", default="runtime/artifacts/bossauto/batch-contact/summary.json")
    parser.add_argument("--out-dir", default="runtime/artifacts/bossauto/batch-contact")
    parser.add_argument("--action-log", default="runtime/artifacts/bossauto/action-log.jsonl")
    parser.add_argument("--decisions", default="runtime/artifacts/bossauto/decisions.json")
    parser.add_argument("--authorization", default="", help="Short current-user approval summary; required with --apply.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum actionable targets after filtering; 0 means no limit.")
    parser.add_argument("--name-contains", default="", help="Optional extra visible-name guard for target loading.")
    parser.add_argument("--include-contacted", action="store_true", help="Keep already-contacted scan rows as skipped targets.")
    parser.add_argument("--continue-on-error", action="store_true", help="Continue after failed or needs_review results.")
    parser.add_argument("--screenshots", action="store_true", help="Save before/after screenshots for each target.")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--executable")
    parser.add_argument("--channel")
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--timezone", default="Asia/Shanghai")
    parser.add_argument("--viewport", default="1366x768")
    parser.add_argument("--wait-ms", type=int, default=8000)
    parser.add_argument("--headless", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.apply and not args.authorization:
        raise SystemExit("--authorization is required when --apply is supplied.")

    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    output_json = Path(args.json).expanduser().resolve()
    output_json.parent.mkdir(parents=True, exist_ok=True)
    action_log = Path(args.action_log).expanduser().resolve()
    decisions = Path(args.decisions).expanduser().resolve()
    targets, source_meta = load_targets(args)
    source_url, source_url_from, url_warnings = resolve_source_url(args, source_meta)
    if args.apply and source_url_from == "default-url":
        raise SystemExit(
            "--apply requires an explicit --url or a scan JSON with a source URL. "
            "The default interaction page is only a fallback for dry-run planning."
        )
    if args.apply and url_warnings:
        raise SystemExit(
            "--apply refused because the approved source URL is ambiguous: " + "; ".join(url_warnings)
        )
    if args.apply and not is_boss_recruiting_url(source_url):
        raise SystemExit(f"--apply refused because the approved source URL is not a BOSS recruiting page: {source_url}")

    summary: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "url": source_url,
        "requestedUrl": args.url,
        "sourceUrlUsed": source_url,
        "sourceUrlFrom": source_url_from,
        "urlWasDefault": source_url_from == "default-url",
        "sourcePageType": page_type(source_url),
        "sourceArtifact": source_meta,
        "urlWarnings": url_warnings,
        "apply": args.apply,
        "authorization": args.authorization,
        "targetCount": len(targets),
        "warning": (
            "Batch contact initiation is outreach. The script clicks only scoped contact-initiation buttons. "
            "It does not type, edit, or manually send chat messages; BOSS may auto-send a preset greeting."
        ),
        "results": [],
        "counts": {},
    }

    launch_options: dict[str, Any] = {
        "user_data_dir": str(Path(args.profile).expanduser().resolve()),
        "headless": args.headless,
        "locale": args.locale,
        "timezone_id": args.timezone,
        "viewport": parse_viewport(args.viewport),
    }
    if args.executable:
        launch_options["executable_path"] = str(Path(args.executable).expanduser().resolve())
    if args.channel:
        launch_options["channel"] = args.channel

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(**launch_options)
        page = next((pg for pg in context.pages if "zhipin.com" in pg.url), None)
        if page is None:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(source_url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_load_state("domcontentloaded", timeout=15000)
        wait_for_cards(page, args.wait_ms)
        summary["pageBefore"] = {
            "url": safe_url(page.url),
            "title": page.title(),
            "frames": [{"name": item.name, "url": safe_url(item.url)} for item in page.frames],
        }
        active_page_type = page_type(page.url)
        source_page_type = page_type(source_url)
        if args.apply and not is_boss_recruiting_url(page.url):
            message = f"active page is not a BOSS recruiting page: {safe_url(page.url)}"
            summary.setdefault("pageWarnings", []).append(message)
            output_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
            context.close()
            raise SystemExit("--apply refused because " + message)
        if source_page_type != "other" and active_page_type != "other" and source_page_type != active_page_type:
            message = (
                f"active BOSS page type ({active_page_type}) differs from approved source page type "
                f"({source_page_type})"
            )
            summary.setdefault("pageWarnings", []).append(message)
            output_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
            if args.apply:
                context.close()
                raise SystemExit("--apply refused because " + message)

        for index, target in enumerate(targets, start=1):
            result_path = out_dir / f"{index:03d}-{safe_slug(target.get('name') or target.get('key') or str(index))}.json"
            try:
                result = process_target(page, target, args, out_dir, index)
            except Exception as exc:
                result = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "candidateKey": target.get("key", ""),
                    "stableId": target.get("stableId", ""),
                    "name": target.get("name", ""),
                    "sourceIndex": target.get("sourceIndex"),
                    "action": "contact_init",
                    "apply": args.apply,
                    "status": "failed",
                    "reason": "exception while processing target",
                    "error": f"{type(exc).__name__}: {exc}",
                }
            result["resultPath"] = str(result_path)
            result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            summary["results"].append(result)
            log_result(args, result, action_log, decisions)
            status = result["status"]
            summary["counts"][status] = summary["counts"].get(status, 0) + 1
            output_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

            if status in {"failed", "needs_review"} and not args.continue_on_error:
                summary["stoppedEarly"] = True
                summary["stopReason"] = f"{status}: {result.get('reason', '')}"
                break

        summary["afterScan"] = {
            "url": safe_url(page.url),
            "title": page.title(),
            "candidates": scan_visible_candidates(page),
        }
        output_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        context.close()

    failing = summary["counts"].get("failed", 0)
    return 1 if failing else 0


if __name__ == "__main__":
    raise SystemExit(main())
