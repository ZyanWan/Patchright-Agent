# Login Troubleshooting

Use this reference when BOSS login appears successful in the phone app but the desktop page remains in a loading state, or when BOSS reports a network error inside a Patchright browser.

## Principles

- Do not bypass QR login, SMS verification, CAPTCHA, MFA, app confirmation, or account checks.
- Let the user complete all login and confirmation steps manually.
- Treat persistent profiles as sensitive state because they can contain cookies, local storage, IndexedDB, permissions, cache, and account hints.
- Prefer reusing a successful profile before asking the user to log in again.
- Keep diagnostics read-only: collect page state, console errors, failed request metadata, frame URLs, screenshots, and cookie names/domains, but not cookie values.

## QR/App Login Succeeds But Page Keeps Loading

1. Ask the user whether the phone app showed an explicit confirmation success.
2. If the desktop page also showed a brief success message but then keeps loading, assume the login token may already be written to the profile.
3. Close the browser process that owns the profile so the profile is not locked.
4. Reopen the same profile directly to a recruiting target page, usually:

```text
https://www.zhipin.com/web/chat/recommend
```

5. If the target page opens with recruiting navigation, user identity, `recommendFrame`, or candidate cards, consider the login successful even if the original login page did not navigate cleanly.
6. Save a read-only diagnostic screenshot and JSON when the state is unclear.

## Network Abnormal In Patchright

If the user says the computer network works but BOSS shows a network-abnormal page inside Patchright:

1. Compare command-line reachability and the user's normal browser. A command-line TCP or HTTP failure can coexist with a working regular browser if the browser uses system proxy, PAC, VPN, security software, or a different network stack.
2. Try the user's installed Chrome/Edge executable with Patchright when bundled Chromium behaves differently. Supply the executable path at runtime; do not hardcode it in the skill.
3. Reuse the same workspace-local profile only after the previous browser session is closed.
4. Run `scripts/diagnose_login.py` and check:
   - final URL and title
   - visible body text
   - frame names such as `recommendFrame` or `searchFrame`
   - failed requests
   - console errors
   - cookie names/domains, not values
5. If diagnostics show recruiting navigation and candidate cards, proceed as logged in. If diagnostics show only a login page, ask the user to retry manual login.

## Common Interpretation

- `扫描成功，请在App端确认登录`: wait for the user to confirm in the app; do not automate this step.
- Desktop login success followed by endless loading: restart the browser and open the target recruiting URL with the same profile.
- `recommendFrame` loaded plus candidate cards visible: recruitment page is usable even if the prior login tab was stuck.
- `chrome-extension://invalid/` failures: usually background extension/probing noise; do not treat alone as login failure.
- Localhost probe failures from BOSS security scripts can appear in console. Correlate with actual page usability before treating them as blockers.
