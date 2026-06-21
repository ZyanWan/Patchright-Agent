import argparse
from pathlib import Path

from patchright.sync_api import sync_playwright


DEFAULT_URL = "https://www.zhipin.com/web/chat/recommend"


def parse_viewport(value: str) -> dict[str, int]:
    width, height = value.lower().replace(" ", "").split("x", 1)
    return {"width": int(width), "height": int(height)}


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Open a visible BOSS recruiting page with a persistent profile. "
            "Relative paths are resolved from the current working directory."
        )
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="BOSS recruiting URL to open.")
    parser.add_argument("--profile", default="runtime/profiles/bossauto-profile", help="Persistent profile directory.")
    parser.add_argument("--executable", help="Optional installed Chrome/Edge executable path.")
    parser.add_argument("--channel", help="Optional Chromium channel, for example chrome or msedge.")
    parser.add_argument("--locale", default="zh-CN", help="Browser locale.")
    parser.add_argument("--timezone", default="Asia/Shanghai", help="Browser timezone id.")
    parser.add_argument("--viewport", default="1366x768", help="Viewport as WIDTHxHEIGHT.")
    parser.add_argument("--headless", action="store_true", help="Run headless instead of visible.")
    args = parser.parse_args()

    profile = Path(args.profile).expanduser().resolve()
    profile.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        launch_options: dict[str, object] = {
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

        context = p.chromium.launch_persistent_context(**launch_options)
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(args.url, wait_until="domcontentloaded")
        print(f"Opened {page.url}")
        print(f"Title: {page.title()}")
        print(f"Profile: {profile}")
        if not args.headless:
            input("Press Enter to close the browser...")
        context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
