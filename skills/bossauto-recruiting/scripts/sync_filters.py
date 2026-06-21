import argparse
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from patchright.sync_api import sync_playwright


DEFAULT_URL = "https://www.zhipin.com/web/chat/recommend"
BOSS_HOSTS = {"www.zhipin.com"}


def parse_viewport(value: str) -> dict[str, int]:
    width, height = value.lower().replace(" ", "").split("x", 1)
    return {"width": int(width), "height": int(height)}


def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).expanduser().resolve().read_text(encoding="utf-8-sig"))


def is_boss_recruiting_url(url: str) -> bool:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    return parsed.scheme == "https" and parsed.netloc.lower() in BOSS_HOSTS and parsed.path.startswith("/web/chat/")


def page_type(url: str) -> str:
    if "/web/chat/recommend" in url:
        return "recommend"
    if "/web/chat/search" in url:
        return "search"
    return "other"


def preferred_frame(page):
    kind = page_type(page.url)
    preferred_name = {"recommend": "recommendFrame", "search": "searchFrame"}.get(kind)
    if preferred_name:
        for frame in page.frames:
            if frame.name == preferred_name:
                return frame
    return page.main_frame


def recommend_filter_state(frame) -> dict[str, Any]:
    panel_opened = False
    if not frame.locator("div.filter-panel").first.is_visible(timeout=1000):
        trigger = frame.locator("div.recommend-filter div.filter-label-wrap").first
        if trigger.count() > 0:
            trigger.click(timeout=3000)
            panel_opened = True
            frame.page.wait_for_timeout(500)

    state = frame.locator("body").evaluate(
        """() => {
            const text = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
            const activeClass = (el) => /\\b(active|selected|on|checked)\\b/.test(String(el?.className || ''));
            const rows = Array.from(document.querySelectorAll('div.filter-panel div.filter-item')).map((item) => {
                const labelNode =
                    item.querySelector('.filter-name') ||
                    item.querySelector('.name') ||
                    item.querySelector('.label') ||
                    item.firstElementChild;
                const label = text(labelNode);
                const options = Array.from(item.querySelectorAll('div.options div.option, .option')).map((option) => ({
                    text: text(option),
                    active: activeClass(option)
                })).filter((option) => option.text);
                return { label, active: options.filter((option) => option.active).map((option) => option.text), options };
            }).filter((row) => row.label || row.options.length);
            return { rows };
        }"""
    )
    state["panelOpened"] = panel_opened
    return state


def search_filter_state(frame) -> dict[str, Any]:
    return frame.locator("body").evaluate(
        """() => {
            const text = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
            const checked = (sel) => Array.from(document.querySelectorAll(sel)).map(text).filter(Boolean);
            return {
                city: text(document.querySelector('.city-wrap')).replace(/\\s+/g, ''),
                selectedSchools: checked('.school-ui label.checkbox.checked'),
                degreeText: text(document.querySelector('.degree-select-custom-content')),
                experienceText: text(document.querySelector('.experience-select-custom-content')),
                salaryText: text(document.querySelector('.salary-container .double-select-gray-inner-flip')),
                dropdowns: Array.from(document.querySelectorAll('.more-filter-container .dropdown-wrap')).map(text).filter(Boolean)
            };
        }"""
    )


def desired_filters(criteria: dict[str, Any], kind: str) -> dict[str, list[str]]:
    filters = criteria.get("filters") or {}
    selected = filters.get(kind) or {}
    return {str(key): [str(v) for v in value] for key, value in selected.items() if isinstance(value, list) and value}


def compare_recommend(current: dict[str, Any], desired: dict[str, list[str]]) -> list[dict[str, Any]]:
    rows = current.get("rows") or []
    by_label = {row.get("label"): row for row in rows if row.get("label")}
    diffs: list[dict[str, Any]] = []
    for label, wanted in desired.items():
        row = by_label.get(label)
        if not row:
            diffs.append({"label": label, "wanted": wanted, "status": "missing-label"})
            continue
        options = {option.get("text") for option in row.get("options") or []}
        missing_options = [value for value in wanted if value not in options]
        active = row.get("active") or []
        missing_active = [value for value in wanted if value not in active]
        status = "ok" if not missing_options and not missing_active else "different"
        diffs.append(
            {
                "label": label,
                "wanted": wanted,
                "active": active,
                "missingOptions": missing_options,
                "missingActive": missing_active,
                "status": status,
            }
        )
    return diffs


def apply_recommend(frame, desired: dict[str, list[str]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    if not frame.locator("div.filter-panel").first.is_visible(timeout=1000):
        frame.locator("div.recommend-filter div.filter-label-wrap").first.click(timeout=3000)
        frame.page.wait_for_timeout(500)

    for label, wanted_values in desired.items():
        row = frame.locator("div.filter-panel div.filter-item", has_text=label).first
        if row.count() == 0:
            results.append({"label": label, "status": "missing-label"})
            continue
        for wanted in wanted_values:
            option = row.locator("div.options div.option", has_text=wanted).first
            if option.count() == 0:
                results.append({"label": label, "option": wanted, "status": "missing-option"})
                continue
            text = option.inner_text(timeout=1000).strip()
            if text != wanted:
                results.append({"label": label, "option": wanted, "actual": text, "status": "ambiguous-option"})
                continue
            klass = option.evaluate("(el) => String(el.className || '')")
            if any(token in klass for token in ("active", "selected", "on", "checked")):
                results.append({"label": label, "option": wanted, "status": "already-active"})
                continue
            option.click(timeout=3000)
            results.append({"label": label, "option": wanted, "status": "clicked"})

    return results


def confirm_recommend_filters(frame) -> dict[str, Any]:
    result: dict[str, Any] = {
        "confirmButtonFound": False,
        "confirmClicked": False,
        "panelClosed": False,
        "errors": [],
    }
    buttons = frame.locator("div.filter-panel div.btn", has_text="确定")
    if buttons.count() == 0:
        result["errors"].append("missing-confirm-button")
        return result

    result["confirmButtonFound"] = True
    try:
        buttons.first.click(timeout=3000)
        result["confirmClicked"] = True
    except Exception as exc:  # noqa: BLE001
        result["errors"].append(f"confirm-click-failed: {exc}")
        return result

    try:
        frame.locator("div.filter-panel").first.wait_for(state="hidden", timeout=5000)
        result["panelClosed"] = True
    except Exception as exc:  # noqa: BLE001
        result["errors"].append(f"filter-panel-still-open: {exc}")
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Inspect BOSS filter state and optionally apply exact recommendation-page filters. "
            "Default mode is read-only."
        )
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="BOSS URL to inspect.")
    parser.add_argument("--profile", default="runtime/profiles/bossauto-profile", help="Persistent profile directory.")
    parser.add_argument("--criteria", required=True, help="Workspace-local criteria JSON file.")
    parser.add_argument("--json", default="runtime/artifacts/bossauto/filter-state.json", help="Output JSON path.")
    parser.add_argument("--executable", help="Optional installed Chrome/Edge executable path.")
    parser.add_argument("--channel", help="Optional Chromium channel, for example chrome or msedge.")
    parser.add_argument("--locale", default="zh-CN", help="Browser locale.")
    parser.add_argument("--timezone", default="Asia/Shanghai", help="Browser timezone id.")
    parser.add_argument("--viewport", default="1366x768", help="Viewport as WIDTHxHEIGHT.")
    parser.add_argument("--wait-ms", type=int, default=5000, help="Time to wait after DOM ready.")
    parser.add_argument("--apply", action="store_true", help="Apply exact recommendation-page filter changes.")
    parser.add_argument("--headless", action="store_true", help="Run headless instead of visible.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    criteria = load_json(args.criteria)
    profile = Path(args.profile).expanduser().resolve()
    profile.mkdir(parents=True, exist_ok=True)
    output_json = Path(args.json).expanduser().resolve()
    output_json.parent.mkdir(parents=True, exist_ok=True)

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
        page.wait_for_timeout(args.wait_ms)
        frame = preferred_frame(page)
        kind = page_type(page.url)
        desired = desired_filters(criteria, kind)
        before = recommend_filter_state(frame) if kind == "recommend" else search_filter_state(frame)
        comparison = compare_recommend(before, desired) if kind == "recommend" else []
        applied = []
        confirm = {
            "confirmButtonFound": None,
            "confirmClicked": False,
            "panelClosed": None,
            "errors": [],
        }
        after = None
        if args.apply:
            if not is_boss_recruiting_url(page.url):
                raise SystemExit(f"--apply refused because the active page is not a BOSS recruiting page: {page.url}")
            if kind != "recommend":
                raise SystemExit("--apply currently supports recommendation pages only.")
            unsafe = [item for item in comparison if item.get("missingOptions") or item.get("status") == "missing-label"]
            if unsafe:
                raise SystemExit(f"Refusing to apply unresolved filters: {unsafe}")
            applied = apply_recommend(frame, desired)
            confirm = confirm_recommend_filters(frame)
            if not confirm.get("panelClosed"):
                raise SystemExit(f"Filter confirmation failed: {confirm}")
        after = recommend_filter_state(frame) if kind == "recommend" else search_filter_state(frame)
        result = {
            "url": page.url,
            "title": page.title(),
            "pageType": kind,
            "frameName": frame.name,
            "criteria": str(Path(args.criteria).expanduser().resolve()),
            "apply": args.apply,
            "desired": desired,
            "before": before,
            "comparison": comparison,
            "applied": applied,
            "confirm": confirm,
            "after": after,
        }
        output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
