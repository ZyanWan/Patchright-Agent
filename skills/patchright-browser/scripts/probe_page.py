import argparse
import json
from pathlib import Path
from typing import Optional

from patchright.sync_api import sync_playwright


def resolve_workspace_root(value: Optional[str]) -> Optional[Path]:
    if not value:
        return None
    workspace = Path(value).expanduser().resolve()
    if not workspace.exists():
        raise ValueError(f"--workspace does not exist: {workspace}")
    if not workspace.is_dir():
        raise ValueError(f"--workspace is not a directory: {workspace}")
    return workspace


def resolve_workspace_path(value: str, workspace: Optional[Path], label: str) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path.resolve()
    if not workspace:
        raise ValueError(
            f"{label} uses a relative path ({value!r}). Pass --workspace <target-workspace> "
            "or provide an absolute path so runtime files are not created in the wrong directory."
        )
    resolved = (workspace / path).resolve()
    if workspace not in (resolved, *resolved.parents):
        raise ValueError(f"{label} must stay inside --workspace when using a relative path: {value!r}")
    return resolved


def parse_viewport(value: str) -> dict[str, int]:
    width, height = value.lower().replace(" ", "").split("x", 1)
    return {"width": int(width), "height": int(height)}


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Probe a page with Patchright and write diagnostics. "
            "Relative runtime paths require --workspace so files are written "
            "under the target workspace instead of the caller's current directory."
        )
    )
    parser.add_argument("--url", required=True, help="URL to inspect.")
    parser.add_argument("--workspace", help="Target workspace root used to resolve relative runtime paths.")
    parser.add_argument("--profile", default="runtime/profiles/patchright-profile", help="Persistent browser profile directory.")
    parser.add_argument("--locale", default="en-US", help="Browser locale.")
    parser.add_argument("--timezone", default="UTC", help="Browser timezone id.")
    parser.add_argument("--viewport", default="1366x768", help="Viewport as WIDTHxHEIGHT.")
    parser.add_argument("--screenshot", help="Optional PNG screenshot output path.")
    parser.add_argument("--json", default="runtime/artifacts/patchright-probe.json", help="Diagnostics JSON output path.")
    parser.add_argument("--headless", action="store_true", help="Run headless instead of visible.")
    args = parser.parse_args()

    try:
        workspace = resolve_workspace_root(args.workspace)
        profile = resolve_workspace_path(args.profile, workspace, "--profile")
        output_json = resolve_workspace_path(args.json, workspace, "--json")
        screenshot_path = resolve_workspace_path(args.screenshot, workspace, "--screenshot") if args.screenshot else None
    except ValueError as exc:
        parser.error(str(exc))

    profile.mkdir(parents=True, exist_ok=True)

    output_json.parent.mkdir(parents=True, exist_ok=True)

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
        page = context.pages[0] if context.pages else context.new_page()
        response = page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_load_state("networkidle", timeout=10000)
        browser_info = page.evaluate(
            """() => ({
                userAgent: navigator.userAgent,
                webdriver: navigator.webdriver,
                language: navigator.language,
                languages: navigator.languages,
                platform: navigator.platform,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                viewport: { width: innerWidth, height: innerHeight },
                devicePixelRatio: devicePixelRatio
            })"""
        )
        result = {
            "url": page.url,
            "title": page.title(),
            "status": response.status if response else None,
            "profile": str(profile),
            "browser": browser_info,
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
