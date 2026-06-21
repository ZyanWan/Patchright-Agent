import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any

from patchright.sync_api import sync_playwright


BOSS_HOME = "https://www.zhipin.com/"
CARD_SELECTORS = [
    "li.geek-info-card",
    "div.candidate-card-wrap",
    "li.card-item div.candidate-card-wrap",
    "li.card-item",
    ".geek-item",
    ".candidate-card",
]
CONTACTED_RE = re.compile(r"已沟通|沟通记录|继续沟通|已打招呼|已联系|已交换|聊过")


def parse_viewport(value: str) -> dict[str, int]:
    width, height = value.lower().replace(" ", "").split("x", 1)
    return {"width": int(width), "height": int(height)}


def short_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def candidate_key(item: dict[str, Any]) -> str:
    stable_id = item.get("stableId") or ""
    if stable_id:
        return f"id:{stable_id}"
    name = item.get("name") or "unknown"
    text = re.sub(r"\s+", " ", item.get("text") or "").strip()
    return f"text:{name}:{short_hash(text)}"


def detect_page_type(url: str) -> str:
    if "/web/chat/search" in url:
        return "search"
    if "/web/chat/recommend" in url:
        return "recommend"
    if "/web/chat/" in url:
        return "chat"
    if "zhipin.com" in url:
        return "boss"
    return "other"


def preferred_frame_name(url: str) -> str | None:
    if "/web/chat/search" in url:
        return "searchFrame"
    if "/web/chat/recommend" in url:
        return "recommendFrame"
    return None


def ordered_frames(page) -> list[Any]:
    target_frame_name = preferred_frame_name(page.url)
    frames = page.frames
    if target_frame_name:
        preferred = [frame for frame in frames if frame.name == target_frame_name]
        frames = preferred + [frame for frame in frames if frame.name != target_frame_name]
    return frames


def visible_count(locator, sample_limit: int = 20) -> int:
    count = locator.count()
    visible = 0
    for i in range(min(count, sample_limit)):
        box = locator.nth(i).bounding_box()
        if box and box["width"] > 50 and box["height"] > 50:
            visible += 1
    return visible


def wait_for_candidate_cards(page, timeout_ms: int) -> None:
    deadline = time.monotonic() + timeout_ms / 1000
    while True:
        for frame in ordered_frames(page):
            for selector in CARD_SELECTORS:
                loc = frame.locator(selector)
                if visible_count(loc) > 0:
                    return
        if time.monotonic() >= deadline:
            return
        page.wait_for_timeout(250)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Scan visible BOSS candidate cards and write JSON. "
            "This is read-only and does not click contact/favorite actions."
        )
    )
    parser.add_argument("--url", default=BOSS_HOME, help="URL to open when no BOSS page is already active.")
    parser.add_argument("--profile", default="runtime/profiles/bossauto-profile", help="Persistent browser profile directory.")
    parser.add_argument("--locale", default="zh-CN", help="Browser locale.")
    parser.add_argument("--timezone", default="Asia/Shanghai", help="Browser timezone id.")
    parser.add_argument("--viewport", default="1366x768", help="Viewport as WIDTHxHEIGHT.")
    parser.add_argument("--json", default="runtime/artifacts/bossauto/candidates.json", help="Candidate JSON output path.")
    parser.add_argument("--executable", help="Optional installed Chrome/Edge executable path.")
    parser.add_argument("--channel", help="Optional Chromium channel, for example chrome or msedge.")
    parser.add_argument("--wait-ms", type=int, default=8000, help="Time to wait for candidate cards after DOM ready.")
    parser.add_argument("--headless", action="store_true", help="Run headless instead of visible.")
    args = parser.parse_args()

    profile = Path(args.profile).expanduser().resolve()
    profile.mkdir(parents=True, exist_ok=True)
    output_json = Path(args.json).expanduser().resolve()
    output_json.parent.mkdir(parents=True, exist_ok=True)
    launch_options = {
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
        page = next((pg for pg in context.pages if "zhipin.com" in pg.url), None)
        if page is None:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_load_state("domcontentloaded", timeout=15000)
        wait_for_candidate_cards(page, args.wait_ms)

        frames_data: list[dict[str, Any]] = []
        candidates: list[dict[str, Any]] = []
        for frame in ordered_frames(page):
            selector = ""
            items = None
            count = 0
            for candidate_selector in CARD_SELECTORS:
                loc = frame.locator(candidate_selector)
                loc_count = loc.count()
                if visible_count(loc, loc_count) > 0:
                    selector = candidate_selector
                    items = loc
                    count = loc_count
                    break
            if items is None:
                continue
            frame_candidates: list[dict[str, Any]] = []
            for i in range(count):
                card = items.nth(i)
                box = card.bounding_box()
                if not box or box["width"] <= 50 or box["height"] <= 50:
                    continue
                data = card.evaluate(
                    """(c) => {
                        const text = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
                        const attr = (sel, name) => c.querySelector(sel)?.getAttribute(name) || '';
                        const timelineText = (kind) => {
                            const selectors = kind === 'work'
                                ? [
                                    '.timeline-wrap.work-exps .timeline-item',
                                    '.work-exps .timeline-item',
                                    '.col-3 .timeline-wrap:not(.edu-exps) .timeline-item'
                                ]
                                : ['.timeline-wrap.edu-exps .timeline-item', '.edu-exps .timeline-item'];
                            for (const sel of selectors) {
                                const lines = Array.from(c.querySelectorAll(sel)).map(text).filter(Boolean);
                                if (lines.length) return lines.join('; ');
                            }
                            return '';
                        };
                        const expectText = () => {
                            const row = Array.from(c.querySelectorAll('.row, .expect, [class*="expect"]'))
                                .find((node) => text(node).includes('期望'));
                            return text(row);
                        };
                        const isDate = (token) =>
                            (/^(?:19|20)\\d{2}/.test(token) && /^[\\d.\\-/~年月日至今现在]+$/.test(token)) ||
                            ['至今', '现在', '目前'].includes(token) ||
                            /^[-–—~至]+$/.test(token);
                        const companyOnlyText = (work) => {
                            return work.split(/[;；]/).map((line) => {
                                const tokens = line.trim().split(/\\s+/).filter(Boolean);
                                let k = 0;
                                while (k < tokens.length && isDate(tokens[k])) k++;
                                return tokens[k] || '';
                            }).filter(Boolean).join('; ');
                        };
                        const titleOnlyText = (work) => {
                            return work.split(/[;；]/).map((line) => {
                                const tokens = line.trim().split(/\\s+/).filter(Boolean);
                                let k = 0;
                                while (k < tokens.length && isDate(tokens[k])) k++;
                                k++;
                                return tokens.slice(k).filter((token) => !isDate(token)).join(' ');
                            }).filter(Boolean).join('; ');
                        };
                        const stableId =
                            attr('[data-geek]', 'data-geek') ||
                            attr('[data-geekid]', 'data-geekid') ||
                            c.getAttribute('data-geek') ||
                            c.getAttribute('data-geekid') ||
                            c.closest('[data-geek]')?.getAttribute('data-geek') ||
                            c.closest('[data-geekid]')?.getAttribute('data-geekid') ||
                            attr('[data-lid]', 'data-lid') ||
                            c.getAttribute('data-lid') ||
                            '';
                        const nameEl =
                            c.querySelector('.name-label') ||
                            c.querySelector('span.name') ||
                            c.querySelector('.geek-name') ||
                            c.querySelector('.row.name-wrap') ||
                            c.querySelector('[class*="name"]');
                        const workText = timelineText('work');
                        const eduText = timelineText('edu');
                        const expected = expectText();
                        return {
                            stableId,
                            name: text(nameEl),
                            companyText: companyOnlyText(workText) || workText,
                            titleText: [expected, titleOnlyText(workText)].filter(Boolean).join('; '),
                            educationText: eduText,
                            text: text(c)
                        };
                    }"""
                )
                data["index"] = len(candidates) + 1
                data["selector"] = selector
                data["frameName"] = frame.name
                data["frameUrl"] = frame.url
                data["contactedLikely"] = bool(CONTACTED_RE.search(data.get("text") or ""))
                data["key"] = candidate_key(data)
                frame_candidates.append(data)
                candidates.append(data)
            frames_data.append(
                {
                    "name": frame.name,
                    "url": frame.url,
                    "selector": selector,
                    "visibleCandidateCount": len(frame_candidates),
                }
            )

        result = {
            "url": page.url,
            "title": page.title(),
            "pageType": detect_page_type(page.url),
            "profile": str(profile),
            "frames": frames_data,
            "candidateCount": len(candidates),
            "candidates": candidates,
        }
        output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
