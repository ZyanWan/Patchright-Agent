---
name: patchright-browser
description: Use this skill when an AI agent needs to perform authorized browser automation with Patchright, including opening a persistent Chromium profile, inspecting pages, taking screenshots, saving lightweight browser diagnostics, reusing login state, and automating user-consented workflows on sites the user is allowed to access. Do not use it to bypass CAPTCHAs, account restrictions, paywalls, blocks, or access controls.
---

# Patchright Browser

## Core Rules

- Use this skill only for authorized automation on sites the user owns, administers, tests, or is explicitly permitted to access.
- Do not help bypass CAPTCHAs, MFA, bans, rate limits, access controls, paywalls, or a site's explicit anti-automation policy.
- Prefer visible Chromium (`headless=False`) and a persistent profile for workflows that should resemble real user browsing.
- Let the user manually complete login, CAPTCHA, MFA, consent, or any sensitive action, then continue automation from the saved profile.
- Request approval before launching a GUI browser or running commands that require network access.

## Environment

Use the active project Python environment. If Patchright is not installed, install it in a project-local environment rather than a global Python whenever practical:

```bash
python -m pip install patchright
python -m patchright install chromium
```

Use a persistent profile directory unless the user asks for a throwaway session. Store browser profiles in the target workspace, not inside the skill folder. If the user does not provide a path, use a workspace-local convention such as:

```text
runtime/profiles/patchright-profile
```

When using the reusable scripts, pass `--workspace <target-workspace>` whenever `--profile`, `--json`, or `--screenshot` is a relative path. Relative runtime paths are resolved under that workspace. If you omit `--workspace`, use absolute paths for all runtime outputs. This prevents accidental `runtime/` folders from being created under the caller's current directory.

Choose locale, timezone, viewport, and profile location from the user's target environment. If the user does not specify them, use neutral defaults and state the assumption.

## Profile Directory

`runtime/profiles/patchright-profile` is an example workspace-local Chromium user data directory created by Patchright when launching a persistent context. It is not part of the skill itself.

It may contain cookies, login sessions, local storage, IndexedDB, cache, site permissions, browsing preferences, and other browser-generated state. Treat it as sensitive because it can preserve access to signed-in accounts.

Use it when the workflow should keep state across runs, such as after the user manually logs in. Use a temporary profile when the workflow must start clean. Deleting the profile resets that browser state and may require the user to log in again.

## Artifacts Directory

Use a workspace-local `runtime/artifacts/` directory for generated outputs such as screenshots, diagnostics JSON, HAR files, logs, downloaded reports, and extracted CSV/JSON data.

`runtime/artifacts/` is separate from the browser profile. Deleting generated artifacts should not reset login state or browser preferences. Do not store persistent browser profiles inside artifacts.

Treat artifacts as potentially sensitive because screenshots, logs, HAR files, and exports can contain page content, request metadata, tokens, or user data. Do not commit or share them unless the user explicitly asks and the contents are safe.

## Workflow

1. Confirm the target is authorized and whether the user wants a visible browser or a scripted check.
2. Start with `scripts/probe_page.py` for page reachability, screenshots, and basic browser diagnostics.
3. Use `scripts/open_persistent.py` when the user needs to manually log in or keep a browser open.
4. Build task-specific scripts by importing `patchright.sync_api` or `patchright.async_api`, following the patterns in `references/patterns.md`.
5. Save generated outputs under a workspace-local artifacts directory, such as `runtime/artifacts/`, unless the user asks for another location.
6. Summarize exactly what was opened, what state was saved, and any commands the user can rerun.

## Capability Map

Use Patchright's Python API for multi-step workflows and stateful automation. Use the CLI for quick screenshots, PDFs, codegen, or manual browser launch.

Common supported tasks include:

- Browser launch with persistent or temporary contexts
- Page navigation, locator-based clicking, form filling, and select controls
- Network waits, API request context calls, cookies, local storage, and browser diagnostics
- File upload, file download, popup windows, iframes, open shadow DOM, dialogs, and drag-and-drop
- Screenshots, PDF export, HAR recording, trace recording, logs, and structured JSON/CSV outputs
- CLI commands such as `open`, `codegen`, `screenshot`, `pdf`, `install`, and `show-trace`

For detailed examples and tested capability notes, read `references/capabilities.md`.

## Reusable Scripts

Open a persistent visible browser and keep it open until the user presses Enter:

```bash
python <skill-dir>/scripts/open_persistent.py --workspace . --url https://example.com --profile runtime/profiles/patchright-profile
```

Probe a page, write diagnostics JSON, and optionally save a screenshot:

```bash
python <skill-dir>/scripts/probe_page.py --workspace . --url https://example.com --profile runtime/profiles/patchright-profile --screenshot runtime/artifacts/example.png --json runtime/artifacts/example.json
```

Resolve `<skill-dir>` to the actual folder containing this `SKILL.md`. Resolve `--workspace` to the target workspace where runtime state and generated artifacts should live. Pass absolute paths for `--profile`, `--screenshot`, and `--json` only when you intentionally want to bypass workspace-relative resolution.

## Implementation Notes

- Prefer locator-based actions such as `get_by_role`, `get_by_label`, and `locator()` over coordinate clicks.
- Use realistic waiting based on page state (`wait_for_load_state`, visible locators, network responses), not fixed sleeps except for short visual inspection pauses.
- Keep locale, timezone, viewport, and profile state internally consistent. Match the user's intended browser environment when known.
- Do not over-customize browser fingerprints. Start from Patchright defaults plus persistent state, then only adjust settings required by the authorized workflow.
- If a site requires user login or MFA, open the persistent browser and stop for the user to complete it manually.
