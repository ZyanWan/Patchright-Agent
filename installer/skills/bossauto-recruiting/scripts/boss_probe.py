import argparse
import json
from pathlib import Path

from patchright.sync_api import sync_playwright


BOSS_HOME = "https://www.zhipin.com/"


def parse_viewport(value: str) -> dict[str, int]:
    width, height = value.lower().replace(" ", "").split("x", 1)
    return {"width": int(width), "height": int(height)}


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


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Inspect an authorized BOSS recruiting browser session. "
            "Relative paths are resolved from the current working directory."
        )
    )
    parser.add_argument("--url", default=BOSS_HOME, help="URL to open when no BOSS page is already active.")
    parser.add_argument("--profile", default="runtime/profiles/bossauto-profile", help="Persistent browser profile directory.")
    parser.add_argument("--locale", default="zh-CN", help="Browser locale.")
    parser.add_argument("--timezone", default="Asia/Shanghai", help="Browser timezone id.")
    parser.add_argument("--viewport", default="1366x768", help="Viewport as WIDTHxHEIGHT.")
    parser.add_argument("--json", default="runtime/artifacts/bossauto/probe.json", help="Diagnostics JSON output path.")
    parser.add_argument("--screenshot", help="Optional PNG screenshot output path.")
    parser.add_argument("--headless", action="store_true", help="Run headless instead of visible.")
    args = parser.parse_args()

    profile = Path(args.profile).expanduser().resolve()
    profile.mkdir(parents=True, exist_ok=True)

    output_json = Path(args.json).expanduser().resolve()
    output_json.parent.mkdir(parents=True, exist_ok=True)

    screenshot_path = Path(args.screenshot).expanduser().resolve() if args.screenshot else None
    if screenshot_path:
        screenshot_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(profile),
            headless=args.headless,
            locale=args.locale,
            timezone_id=args.timezone,
            viewport=parse_viewport(args.viewport),
        )
        page = next((pg for pg in context.pages if "zhipin.com" in pg.url), None)
        if page is None:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_load_state("domcontentloaded", timeout=15000)

        frames = []
        for frame in page.frames:
            card_count = frame.locator(
                "li.geek-info-card, div.candidate-card-wrap, li.card-item, .geek-item, .candidate-card"
            ).count()
            frames.append(
                {
                    "name": frame.name,
                    "url": frame.url,
                    "candidateCardCount": card_count,
                }
            )

        result = {
            "url": page.url,
            "title": page.title(),
            "pageType": detect_page_type(page.url),
            "profile": str(profile),
            "frames": frames,
            "loggedInLikely": "/web/chat" in page.url and "/web/user" not in page.url,
        }
        if screenshot_path:
            page.screenshot(path=str(screenshot_path), full_page=True)
            result["screenshot"] = str(screenshot_path)

        output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
