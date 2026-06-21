# Safety Boundaries

Use this reference before adding website-changing actions.

## Allowed By Default

These operations are acceptable for authorized workflows:

- Open a visible browser session.
- Let the user log in manually.
- Inspect page title, URL, frames, and visible DOM structure.
- Scan visible candidate cards.
- Save screenshots or JSON diagnostics to a local workspace artifact directory.
- Extract candidate detail evidence for user-approved screening.
- Record local decisions without changing the website.
- Create local reports, tables, and handoff artifacts from captured evidence.

## Requires Explicit Current Approval

Ask for explicit approval before actions that change BOSS state, including:

- Contact initiation, greet, contact, or send message.
- Favorite/save/collect a candidate.
- Exchange contact information.
- Change account settings or job postings.
- Bulk actions across multiple candidates.
- Applying filters when the user expects the current page state to remain unchanged.
- Switching the active job or page context for a workflow tied to the current recommendation or candidate list.
- Refreshing or otherwise resetting a recommendation/search list when preserving the current list matters.

Approval should name the action and scope, for example: "favorite these 3 reviewed candidates" or "send greeting to candidate X".

Before performing an approved candidate action, load `controlled-actions.md` and prepare a candidate-specific confirmation checklist. Do not treat a general screening request, a report request, or a high-quality recommendation as permission to click a website-changing action.

Approval to initiate contact is not approval to continue chatting, send a message, use SMS/phone tools, priority reminders, or exchange contact information.

For batch tasks, approval may cover a current-session shortlist generated from evidence, but the action type and scope must still be explicit and logged.

## Not Supported

Do not help with:

- Bypassing login, CAPTCHA, MFA, bans, throttling, account restrictions, paywalls, or access controls.
- Scraping outside the user's authorized recruiting account.
- Concealing automation from a service in ways intended to evade restrictions.
- Sending unsolicited bulk messages without user review and approval.

## Human Review Bias

Recruiting decisions affect people. Use conservative handling:

- If evidence is incomplete, mark `review`.
- If identity is uncertain, mark `review`.
- If the page content cannot be extracted reliably, save evidence and ask for human review.
- Do not reject based on inferred facts that are not visible in the candidate evidence.
- Do not treat soft traits such as responsibility, communication, or teamwork as hard rejects unless the user explicitly defines observable evidence and a hard rule.
