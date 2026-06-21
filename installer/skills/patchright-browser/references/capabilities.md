# Patchright Browser Capabilities

Use this reference when the task needs more than opening a page or taking a basic screenshot.

## Python API

Prefer `patchright.sync_api` for straightforward scripts and `patchright.async_api` when integrating with async code.

Core browser capabilities:

- Launch Chromium with `chromium.launch()` for temporary browser state.
- Launch a persistent Chromium profile with `chromium.launch_persistent_context(user_data_dir=...)`.
- Use `context.new_page()`, `page.goto()`, `page.reload()`, and `page.go_back()` for navigation.
- Use `page.locator()`, `page.get_by_role()`, `page.get_by_label()`, and related locator APIs for actions.
- Use `page.fill()`, `locator.fill()`, `select_option()`, `set_checked()`, and `press()` for forms.
- Use `page.evaluate()` for lightweight diagnostics and page-state reads.

State and environment capabilities:

- Use persistent profiles for cookies, login sessions, local storage, IndexedDB, cache, permissions, and browser preferences.
- Use `context.cookies()`, `context.add_cookies()`, and page storage APIs when the workflow needs state inspection.
- Set locale, timezone, viewport, geolocation, user agent, proxy, and color scheme only when they match the authorized target environment.

Page interaction capabilities:

- File upload: `page.set_input_files()` or `locator.set_input_files()`.
- File download: `page.expect_download()` and `download.save_as()`.
- Popup windows: `page.expect_popup()`.
- Iframes: `page.frame_locator()` or `page.frame()`.
- Open shadow DOM: chain locators through the host when the shadow root is open.
- Dialogs: listen for `dialog` and accept or dismiss based on the user's intent.
- Drag-and-drop: `locator.drag_to()` when the page supports standard drag events.

Network and diagnostics capabilities:

- Wait for responses with `page.expect_response()` or `page.wait_for_response()`.
- Use `context.request` for API calls that share the browser context.
- Record HAR with `record_har_path`.
- Record traces with `context.tracing.start()` and `context.tracing.stop(path=...)`.
- Capture screenshots with `page.screenshot()`.
- Export PDFs with `page.pdf()` on Chromium.

## CLI

Use CLI commands for quick, one-off operations:

```bash
patchright open --user-data-dir runtime/profiles/patchright-profile https://example.com
patchright screenshot --full-page https://example.com runtime/artifacts/page.png
patchright pdf https://example.com runtime/artifacts/page.pdf
patchright codegen --target python https://example.com
patchright install chromium
patchright show-trace runtime/artifacts/trace.zip
```

The Patchright CLI resolves relative paths from the current working directory. Run CLI commands from the target workspace or pass absolute paths for profiles and artifacts. Prefer this skill's Python scripts with `--workspace` when you need stronger protection against writing runtime files into the wrong directory.

Useful shared CLI options include:

- `--user-data-dir` for persistent profile state.
- `--lang`, `--timezone`, and `--viewport-size` for environment consistency.
- `--proxy-server` and `--proxy-bypass` when the authorized environment requires a proxy.
- `--save-har` and `--save-storage` for diagnostics and state export.
- `--load-storage` for workflows that use a saved storage state instead of a full profile.

Avoid CLI `open`, `codegen`, and `show-trace` in unattended automation because they are interactive or long-running.

## Local Validation Coverage

The local capability suite has validated these Patchright features on Chromium:

- Importing the sync Python API
- Opening a persistent Chromium context
- Navigating to a local page
- Evaluating browser diagnostics, including `navigator.webdriver`
- Clicking, filling, selecting, and submitting form controls
- Waiting for a network response
- Uploading and downloading files
- Handling popup windows
- Interacting with iframes
- Interacting with open shadow DOM
- Dragging and dropping
- Accepting alert and confirm dialogs
- Writing screenshots and PDFs
- Navigating between pages
- Sending API requests with `context.request`
- Setting and reading cookies
- Writing HAR and trace artifacts
- Running CLI `screenshot` and `pdf`

The suite confirms that Firefox and WebKit browser type objects are exposed, but it does not validate launched Firefox or WebKit sessions. Treat Patchright's primary patched browser target as Chromium unless the user explicitly requests cross-browser testing.

## Boundaries

- Do not use these capabilities to bypass CAPTCHAs, MFA, access controls, bans, paywalls, or explicit site restrictions.
- Do not claim that `navigator.webdriver == false` proves an automation session is undetectable.
- Do not share profile directories or artifacts without checking for sensitive data.
- Do not rely on fixed sleeps for core workflow correctness; wait for elements, load states, responses, or explicit user handoff.
