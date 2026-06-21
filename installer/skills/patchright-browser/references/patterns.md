# Patchright Browser Patterns

## Persistent Context

Use a persistent context for realistic, repeatable workflows:

```python
from pathlib import Path

from patchright.sync_api import sync_playwright

workspace = Path(".").resolve()

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        user_data_dir=str(workspace / "runtime/profiles/patchright-profile"),
        headless=False,
        locale="en-US",
        timezone_id="UTC",
        viewport={"width": 1366, "height": 768},
    )
    page = context.pages[0] if context.pages else context.new_page()
    page.goto("https://example.com", wait_until="domcontentloaded")
```

Keep the profile directory outside the skill folder when possible. Resolve relative runtime paths against an explicit target workspace, not against whatever process directory happens to launch the script. Do not commit, publish, or share profile directories because they can contain account state and site data.

## Generated Artifacts

Write screenshots, diagnostics JSON, HAR files, logs, and extracted data under the target workspace's `runtime/artifacts/` directory by default:

```text
runtime/artifacts/
```

Keep artifacts separate from persistent browser profiles. Artifacts are usually reproducible outputs, while profiles are browser state.

## Manual Login Handoff

For login, CAPTCHA, or MFA, launch the persistent browser and wait:

```python
input("Complete the manual step in the browser, then press Enter...")
```

Continue after the user confirms. The profile preserves cookies, local storage, IndexedDB, permissions, cache, and browser preferences for later runs. Treat the profile as sensitive because it can contain logged-in sessions.

## Locator-First Actions

Prefer stable, semantic locators:

```python
page.get_by_role("button", name="Search").click()
page.get_by_label("Email").fill("user@example.com")
page.locator("table tbody tr").first.wait_for(state="visible")
```

Use coordinates only when the page has no stable DOM targets and the user accepts the fragility.

## Diagnostics

Useful low-risk diagnostics:

```python
info = page.evaluate("""() => ({
    userAgent: navigator.userAgent,
    webdriver: navigator.webdriver,
    language: navigator.language,
    languages: navigator.languages,
    platform: navigator.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: { width: innerWidth, height: innerHeight }
})""")
```

Treat these as sanity checks, not proof that a browser is indistinguishable from a human user.
