import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from patchright.sync_api import sync_playwright


DEFAULT_URL = "https://www.zhipin.com/web/chat/recommend"


def parse_viewport(value: str) -> dict[str, int]:
    width, height = value.lower().replace(" ", "").split("x", 1)
    return {"width": int(width), "height": int(height)}


def safe_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return url[:240]
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))[:240]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read-only BOSS login/loading diagnostics. "
            "Relative paths are resolved from the current working directory."
        )
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="BOSS URL to inspect.")
    parser.add_argument("--profile", default="runtime/profiles/bossauto-profile", help="Persistent profile directory.")
    parser.add_argument("--json", default="runtime/artifacts/bossauto/login-diagnostics.json", help="JSON output path.")
    parser.add_argument("--screenshot", default="runtime/artifacts/bossauto/login-diagnostics.png", help="PNG screenshot output path.")
    parser.add_argument("--executable", help="Optional installed Chrome/Edge executable path.")
    parser.add_argument("--channel", help="Optional Chromium channel, for example chrome or msedge.")
    parser.add_argument("--locale", default="zh-CN", help="Browser locale.")
    parser.add_argument("--timezone", default="Asia/Shanghai", help="Browser timezone id.")
    parser.add_argument("--viewport", default="1366x768", help="Viewport as WIDTHxHEIGHT.")
    parser.add_argument("--wait-ms", type=int, default=20000, help="Time to observe the page after DOM ready.")
    parser.add_argument("--headless", action="store_true", help="Run headless instead of visible.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    profile = Path(args.profile).expanduser().resolve()
    profile.mkdir(parents=True, exist_ok=True)

    output_json = Path(args.json).expanduser().resolve()
    output_json.parent.mkdir(parents=True, exist_ok=True)

    screenshot_path = Path(args.screenshot).expanduser().resolve()
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)

    events: dict[str, list[dict[str, object]]] = {
        "console": [],
        "pageErrors": [],
        "requestFailures": [],
        "httpErrors": [],
    }

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

        page.on(
            "console",
            lambda msg: events["console"].append(
                {
                    "type": msg.type,
                    "text": msg.text[:500],
                    "location": msg.location,
                }
            ),
        )
        page.on("pageerror", lambda exc: events["pageErrors"].append({"message": str(exc)[:1000]}))
        page.on(
            "requestfailed",
            lambda req: events["requestFailures"].append(
                {
                    "method": req.method,
                    "url": safe_url(req.url),
                    "resourceType": req.resource_type,
                    "failure": req.failure,
                }
            ),
        )

        def record_http_error(res):
            if res.status >= 400:
                events["httpErrors"].append(
                    {
                        "status": res.status,
                        "url": safe_url(res.url),
                        "method": res.request.method,
                        "resourceType": res.request.resource_type,
                    }
                )

        page.on("response", record_http_error)

        goto_error = None
        try:
            page.goto(args.url, wait_until="domcontentloaded", timeout=45000)
        except Exception as exc:  # noqa: BLE001
            goto_error = str(exc)

        page.wait_for_timeout(args.wait_ms)

        try:
            visible_text = page.locator("body").inner_text(timeout=5000)[:5000]
        except Exception as exc:  # noqa: BLE001
            visible_text = f"<failed to read body text: {exc}>"

        try:
            body_html_length = len(page.locator("body").inner_html(timeout=5000))
        except Exception:
            body_html_length = None

        browser_signals = page.evaluate(
            """() => ({
                userAgent: navigator.userAgent,
                webdriver: navigator.webdriver,
                languages: navigator.languages,
                platform: navigator.platform,
                cookieEnabled: navigator.cookieEnabled,
                online: navigator.onLine,
                localStorageKeys: Object.keys(localStorage || {}),
                sessionStorageKeys: Object.keys(sessionStorage || {})
            })"""
        )
        cookies = context.cookies(["https://www.zhipin.com"])
        cookie_summary = [
            {
                "name": cookie.get("name"),
                "domain": cookie.get("domain"),
                "path": cookie.get("path"),
                "expires": cookie.get("expires"),
            }
            for cookie in cookies
        ]
        frame_summary = [{"name": frame.name, "url": safe_url(frame.url)} for frame in page.frames]

        page.screenshot(path=str(screenshot_path), full_page=True)
        result = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "requestedUrl": args.url,
            "finalUrl": page.url,
            "safeFinalUrl": safe_url(page.url),
            "title": page.title(),
            "gotoError": goto_error,
            "profile": str(profile),
            "visibleText": visible_text,
            "bodyHtmlLength": body_html_length,
            "browserSignals": browser_signals,
            "cookieSummary": cookie_summary,
            "frameSummary": frame_summary,
            "events": events,
            "screenshot": str(screenshot_path),
        }
        output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
