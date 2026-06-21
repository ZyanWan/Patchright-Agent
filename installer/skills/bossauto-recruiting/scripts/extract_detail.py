import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from patchright.sync_api import sync_playwright


DEFAULT_URL = "https://www.zhipin.com/web/chat/recommend"
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


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", value, flags=re.UNICODE).strip("._")
    return cleaned[:80] or "candidate"


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
    if box and box["width"] > 50 and box["height"] > 50:
        return box
    return None


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


def pick_card(page, stable_id: str | None, candidate_index: int):
    indexed_cards = []
    for frame in ordered_frames(page):
        seen = 0
        for selector in CARD_SELECTORS:
            loc = frame.locator(selector)
            for i in range(loc.count()):
                card = loc.nth(i)
                if not visible_box(card):
                    continue
                card_id = card.evaluate(
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
                if stable_id and card_id == stable_id:
                    return frame, card
                seen += 1
                indexed_cards.append((frame, card))
            if seen:
                break
    if stable_id:
        return None, None
    if 1 <= candidate_index <= len(indexed_cards):
        return indexed_cards[candidate_index - 1]
    return None, None


def click_card(card) -> None:
    for selector in [".name-label", "span.name", ".geek-name", "[class*='name']", ".row.name-wrap"]:
        target = card.locator(selector).first
        if target.count() > 0 and visible_box(target):
            target.click(timeout=3000)
            return
    card.click(timeout=3000)


def card_text(card) -> str:
    return card.evaluate("(c) => (c.textContent || '').replace(/\\s+/g, ' ').trim()")


def collect_text_and_canvas(page) -> dict[str, Any]:
    frames = []
    for frame in page.frames:
        try:
            text = frame.locator("body").inner_text(timeout=1500)
        except Exception:
            text = ""
        canvas = frame.locator("canvas")
        canvases = []
        for i in range(canvas.count()):
            item = canvas.nth(i)
            box = visible_box(item)
            if not box:
                continue
            try:
                size = item.evaluate(
                    "(el) => ({ width: el.width || 0, height: el.height || 0, className: String(el.className || '') })"
                )
            except Exception:
                size = {}
            canvases.append({"index": i, "box": box, "size": size})
        frames.append(
            {
                "name": frame.name,
                "url": frame.url,
                "textLength": len(text),
                "textSample": text[:1000],
                "canvasCount": len(canvases),
                "canvases": canvases,
            }
        )
    best_text = "\n\n".join(frame["textSample"] for frame in frames if frame["textSample"]).strip()
    return {"frames": frames, "text": best_text}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Open one visible candidate card and save detail evidence. "
            "This is read-only and does not click contact/favorite actions."
        )
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="BOSS URL to inspect.")
    parser.add_argument("--profile", default="runtime/profiles/bossauto-profile", help="Persistent profile directory.")
    parser.add_argument("--stable-id", help="Candidate stable ID from scan_candidates.py.")
    parser.add_argument("--candidate-index", type=int, default=1, help="Visible candidate index fallback, 1-based.")
    parser.add_argument("--candidate-name", default="", help="Expected candidate name for identity check.")
    parser.add_argument("--out-dir", default="runtime/artifacts/bossauto/detail-evidence", help="Output directory.")
    parser.add_argument("--json", default="", help="Optional JSON output path. Defaults inside out-dir.")
    parser.add_argument("--executable", help="Optional installed Chrome/Edge executable path.")
    parser.add_argument("--channel", help="Optional Chromium channel, for example chrome or msedge.")
    parser.add_argument("--locale", default="zh-CN", help="Browser locale.")
    parser.add_argument("--timezone", default="Asia/Shanghai", help="Browser timezone id.")
    parser.add_argument("--viewport", default="1366x768", help="Viewport as WIDTHxHEIGHT.")
    parser.add_argument("--wait-ms", type=int, default=8000, help="Time to wait for cards/detail.")
    parser.add_argument("--headless", action="store_true", help="Run headless instead of visible.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    profile = Path(args.profile).expanduser().resolve()
    profile.mkdir(parents=True, exist_ok=True)
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = f"{stamp}-{safe_filename(args.candidate_name or args.stable_id or str(args.candidate_index))}"
    output_json = Path(args.json).expanduser().resolve() if args.json else out_dir / f"{base}.json"
    screenshot_path = out_dir / f"{base}.png"
    text_path = out_dir / f"{base}.txt"

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

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(**launch_options)
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=45000)
        wait_for_cards(page, args.wait_ms)
        frame, card = pick_card(page, args.stable_id, args.candidate_index)
        if card is None:
            raise SystemExit("No visible candidate card matched the requested target.")
        matched_card_text = card_text(card)
        if args.candidate_name and args.candidate_name not in matched_card_text:
            raise SystemExit(
                "Matched card does not contain the expected candidate name. "
                "Refusing to open a possibly wrong detail."
            )
        before_url = page.url
        click_card(card)
        page.wait_for_timeout(args.wait_ms)
        evidence = collect_text_and_canvas(page)
        page.screenshot(path=str(screenshot_path), full_page=True)
        text_path.write_text(evidence["text"], encoding="utf-8")
        name_present = bool(args.candidate_name and args.candidate_name in evidence["text"])
        result = {
            "requested": {
                "stableId": args.stable_id,
                "candidateIndex": args.candidate_index,
                "candidateName": args.candidate_name,
            },
            "beforeUrl": before_url,
            "afterUrl": page.url,
            "title": page.title(),
            "sourceFrame": {"name": frame.name, "url": frame.url} if frame else None,
            "matchedCardText": matched_card_text[:1000],
            "identity": {
                "expectedName": args.candidate_name,
                "namePresentInText": name_present,
                "status": "matched" if name_present else ("unchecked" if not args.candidate_name else "review"),
            },
            "textPath": str(text_path),
            "screenshot": str(screenshot_path),
            "textLength": len(evidence["text"]),
            "canvasDetected": any(frame_info["canvasCount"] for frame_info in evidence["frames"]),
            "frames": evidence["frames"],
        }
        output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
