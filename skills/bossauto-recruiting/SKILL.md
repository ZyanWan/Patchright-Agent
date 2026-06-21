---
name: bossauto-recruiting
description: "Use this skill when an AI agent assists an authorized recruiter on BOSS recruiting pages with Patchright: task routing across recommendation/search/chat/favorites/job contexts, login and network troubleshooting, page/session inspection, filter inspection or explicit synchronization, candidate-card scanning, detail evidence extraction, vision-first review with OCR fallback, JD or requirement based screening, batch workflows, decision records, recruiter-facing reports, and tightly scoped user-approved actions such as favorite/collect/contact initiation. Do not use it to bypass login, CAPTCHA, MFA, restrictions, platform limits, paid access controls, manually send or edit chat messages, or change BOSS state without explicit current approval, target verification, and action logging."
---

# Bossauto Recruiting

## Core Rules

- Use this skill only for authorized recruiting workflows on accounts the user is permitted to operate.
- Keep BOSS-specific automation here; do not put BOSS workflows into the generic `patchright-browser` skill.
- Prefer visible browser sessions and persistent workspace-local profiles so the user can inspect and take over at any point.
- Let the user complete login, CAPTCHA, MFA, consent, or any sensitive action manually.
- Treat screenshots, extracted text, cookies, candidate records, and decision logs as sensitive recruiting data.
- Do not click "greet", "contact", "send", "favorite", "exchange", or similar write actions unless the user explicitly asked for that exact action in the current task.
- Treat contact initiation as a narrow but real outreach action: clicking a scoped `沟通`, `打招呼`, or `立即沟通` button for an approved candidate. BOSS may automatically send the recruiter's preconfigured greeting after this click. Do not type, edit, manually click `发送`, trigger SMS/phone/priority reminders, or exchange contact information; hand those steps to the recruiter.
- For uncertain candidate matches, preserve evidence and mark for human review instead of silently rejecting.
- Route the task before acting. BOSS recruiting work can be login support, page inspection, recommendation processing, search research, filter management, evidence capture, screening, follow-up, reporting, or controlled actions.
- Preserve the recruiter's current business context. Do not refresh, change jobs, alter filters, reset recommendation lists, or switch page types unless the task requires it or the user explicitly approves it.
- Treat scripts as tools, not as the workflow. The agent remains responsible for checking page context, evidence quality, action authorization, and audit output.

## Workflow

1. Classify the requested task mode before using scripts or clicking the page. If unclear, inspect the current page first and choose the least state-changing path.
2. Open or reuse an authorized browser session using the generic Patchright browser workflow. If needed, use a workspace-local profile such as `runtime/profiles/bossauto-profile`.
   - If QR/App login says it succeeded but the login page remains stuck, do not repeatedly re-login. Close the browser session that owns the profile, then reuse the same profile and open a target recruiting page directly, such as `https://www.zhipin.com/web/chat/recommend`.
   - If BOSS shows "network abnormal" inside Patchright while the user's normal browser works, treat it as a browser/profile/proxy/runtime difference first. Run read-only login diagnostics before changing profile state.
3. Verify the active page is a BOSS recruiting page and identify the page context: recommendation, search, chat/follow-up, favorites/collections, job management, or another recruiting page.
4. Choose the page entry that matches the business goal. Recommendation pages are often best for low-cost candidate operations; search pages are better for market research or expanding the pool; chat/follow-up pages are for existing conversations.
5. For list work, scan visible candidate cards first. Prefer stable identifiers such as `data-geek`, `data-geekid`, or `data-lid`; do not rely only on card index.
6. Load user-provided criteria from a workspace-local file when screening rules or page filters are needed. Use `assets/criteria.example.json` as a template, not as runtime state.
7. Inspect BOSS page filters before changing them. Apply filters only when the user explicitly asks for page-state changes in the current task.
8. Apply deterministic checks and deduplication before opening details. Missing or partial evidence should usually become `review`, not `reject`.
9. Open details only for candidates that pass list-level checks or need evidence. Extract text, save screenshots or JSON when useful, and verify the detail belongs to the intended candidate when possible.
10. When detail evidence is visual or canvas-rendered, use a vision-first review if the current agent can inspect images. If it cannot, use OCR only through an available, approved OCR path and keep OCR text separate from DOM text.
11. Evaluate against user-provided criteria or a separate resume-evaluation skill. Use observable evidence; do not invent missing facts. Split requirements into hard constraints, preferences, risks, unknowns, and criteria that BOSS evidence cannot support.
12. For batch workflows, run a small read-only or low-risk verification batch before scaling. Keep progress artifacts, event logs, and resumable outputs.
13. Produce structured summaries, reports, or quick-screen evaluations only when the user asks to aggregate BOSS data, generate a report, create a table, or evaluate candidates against a JD or recruiter requirements. Base fields only on BOSS evidence and user-provided requirements.
14. For website-changing actions such as favorite/collect, contact initiation, send, exchange, mark unsuitable, or changing job/filter state, use the controlled-action workflow: require explicit current user authorization, target verified candidate keys or current-session shortlist rules, perform only the approved action/scope, and log every outcome. Contact initiation may send the recruiter's preset greeting automatically, so treat it as outreach. Batch contact initiation is the normal path when multiple saved or shortlisted candidates are approved; single-candidate contact is for tests, retries, and manual review cases. It ends after the approved button click and verification; ongoing chat is manual unless a future task defines a stricter message workflow.
15. Record decisions in a workspace-local artifact, separating global action records from project-specific screening records when the workflow needs duplicate protection.
16. Summarize what was inspected, what was saved, which candidates need human review, which approved actions ran, which actions were not attempted, and where the audit artifacts are stored.

## Reference Routing

Do not load every reference by default. Read in layers: first the document that decides direction, then any risk gate that constrains the work, then the narrow operation detail. Treat mandatory gates below as required.

### Start Here

- Multi-mode, ambiguous, or page-choice task: read `references/task-modes.md`.
- Long-running, high-impact, batch, or script-heavy task: read `references/agent-operating-principles.md`.
- If the task is clearly a tiny one-candidate inspection, you may skip these and load only the specific reference needed below.

### Mandatory Gates

- Any website-changing action, including favorite, collect, greet, contact, send, exchange, mark unsuitable, job changes, or filter changes: read `references/safety.md` and `references/controlled-actions.md`.
- Any multi-candidate, target-count, scrolling, or batch task: read `references/batch-workflows.md` and `references/screening-funnel.md`.
- Any JD, recruiter requirements, criteria file, ranking, or candidate evaluation task: read `references/screening-funnel.md` and `references/criteria-and-filters.md`.
- Any report, table, spreadsheet, structured summary, or handoff artifact: read `references/reporting-and-structured-review.md`.
- Any filter inspection or filter mutation: read `references/filter-sync.md`; if mutation is possible, also read `references/safety.md`.

### Operation Details

Use these only when that operation is part of the current task.

| Operation need | Read |
| --- | --- |
| Login handoff, stuck QR/App login, network abnormal, profile/session symptoms | `references/login-troubleshooting.md` |
| Page type, frames, candidate selectors, stable IDs, scrolling, detail containers | `references/page-patterns.md` |
| Turning JD or recruiter requirements into criteria and deterministic checks | `references/criteria-and-filters.md` |
| Inspecting or applying BOSS filters | `references/filter-sync.md` |
| Opening details, saving text/screenshots, checking identity, canvas-rendered content | `references/detail-evidence.md` |
| Interpreting screenshots or image-rendered resume content with vision/OCR fallback | `references/vision-review.md` |
| Multi-step screening funnel or model gates | `references/screening-funnel.md` |
| Batch processing, target counts, batch actions, final audit | `references/batch-workflows.md` |
| Favorites, collect, contact initiation, send, exchange, mark unsuitable, or any state change | `references/controlled-actions.md` and `references/safety.md` |
| Deduplication, contacted records, project records, action logs | `references/decision-records.md` |
| Candidate tables, Excel/report outputs, structured review fields, delivery checks | `references/reporting-and-structured-review.md` |
| Concrete script command examples and CLI usage details | `references/script-usage.md` |

### Loading Discipline

- If a mandatory gate applies, read it before running the relevant script or clicking the page.
- Prefer one routing reference plus one or two task references. Add more only when the workflow expands.
- If a task changes from read-only to action-taking, pause and load the action references before proceeding.
- If a script or previous task suggests a page, URL, action, or path that conflicts with the current user request, follow the current request and routing table.

## Reusable Scripts

Resolve `<skill-dir>` to the folder containing this `SKILL.md`. Run commands from the target workspace, or pass absolute workspace paths for output, profile, and record files. Treat example URLs as examples: the current user request, current page, and approved target source take priority. For concrete command examples, load `references/script-usage.md` only when needed.

Scripts are tools, not authorization. Before running a script that can change BOSS state, load `references/safety.md` and `references/controlled-actions.md`, verify the target scope, and preserve an audit log.

### Script Selection

| Task need | Prefer script | Website state | Read first | Notes |
| --- | --- | --- | --- | --- |
| Open a visible recruiting page for login, handoff, or inspection | `open_recruiting_page.py` | No recruiting action | `login-troubleshooting.md` or `page-patterns.md` | Keeps a persistent profile available for manual login or takeover. |
| Inspect the current page, frames, title, URL, and screenshot | `boss_probe.py` | Read-only | `page-patterns.md` | Use before choosing a page-specific workflow when context is unclear. |
| Diagnose stuck login, loading, or network symptoms | `diagnose_login.py` | Read-only | `login-troubleshooting.md` | Use `--channel` or `--executable` only when the runtime browser differs from the user's working browser. |
| Scan visible candidate cards | `scan_candidates.py` | Read-only | `page-patterns.md`; add `batch-workflows.md` for many candidates | Saves stable IDs, visible text, frame data, and duplicate-contact signals. |
| Apply deterministic criteria to scanned JSON | `dry_run_screening.py` | Local file only | `criteria-and-filters.md` and `screening-funnel.md` | Use BOSS evidence plus recruiter/JD requirements; do not invent missing facts. |
| Inspect or explicitly synchronize page filters | `sync_filters.py` | Read-only unless `--apply` | `filter-sync.md`; add `safety.md` before `--apply` | `--apply` is a page-state change and currently supports exact recommendation-page filter changes. |
| Extract one candidate's detail evidence | `extract_detail.py` | Opens detail; no write action | `detail-evidence.md`; add `vision-review.md` for screenshots/canvas | Prefer `--stable-id`; `--candidate-index` is only a fallback for evidence collection, not controlled actions. |
| Favorite or collect one approved candidate | `favorite_candidate.py` | Website-changing only with `--apply` | `safety.md`, `controlled-actions.md`, `decision-records.md` | Use only after exact current approval and stable target verification. |
| Initiate contact for an approved batch | `batch_contact_candidates.py` | Website-changing only with `--apply` | `safety.md`, `controlled-actions.md`, `batch-workflows.md`, `decision-records.md` | Preferred for multiple approved candidates; opens one browser session and logs every target. |
| Initiate contact for one approved candidate | `contact_candidate.py` | Website-changing only with `--apply` | `safety.md`, `controlled-actions.md`, `decision-records.md` | Use for tests, retries, and one-off review targets. |
| Record a local decision | `record_decision.py` | Local file only | `decision-records.md` | Does not click BOSS. |
| Record a local action log entry | `record_action_log.py` | Local file only | `controlled-actions.md` and `decision-records.md` | Does not authorize or perform the action; it only records what happened. |

### Common Parameters

- `--profile`: persistent workspace-local browser state, such as `runtime/profiles/bossauto-profile`. Profiles may contain cookies and login state.
- `--url`: page to open when no usable BOSS page is already active. Use the current task's page source; do not blindly copy sample URLs.
- `--json`, `--out-dir`, `--action-log`, `--decisions`: workspace-local runtime artifacts, usually under `runtime/artifacts/bossauto/`.
- `--channel` or `--executable`: optional runtime-browser selection. Supply these from the current environment only; do not hardcode local app paths in the skill.
- `--apply`: website-changing gate. Without it, controlled scripts should inspect, plan, or dry-run.
- `--authorization`: short audit text for current user approval. Required by controlled-action scripts when `--apply` is supplied.

### Misuse Guards

- Do not use card index or current visual order as a durable controlled-action target.
- Do not shell-loop the single-candidate contact script for routine batch outreach; use `batch_contact_candidates.py`.
- Do not add `--apply` because a candidate looks high quality. Approval must be explicit and current.
- Do not use `--apply` on non-BOSS pages. Controlled-action scripts should refuse website changes unless the active page is a BOSS recruiting page.
- Do not treat `record_action_log.py` action names as supported automation capabilities. `send_message`, contact-data exchange, phone/SMS, and continued chat remain unsupported unless a future stricter workflow defines them.
- Do not blindly use `/web/chat/interaction`; pass the page URL that matches the approved source page or target artifact.
- Do not refresh, switch jobs, reset filters, or change page type just to make a script easier to run unless the current task approves that change.

## Implementation Notes

- Prefer `patchright.sync_api` for reusable scripts in this skill.
- Prefer locator actions and frame-aware logic. BOSS list content can be inside `searchFrame`, `recommendFrame`, or `interactionFrame`.
- Use short waits for DOM readiness and visible elements, not blind long sleeps.
- Save generated outputs under a workspace-local `runtime/artifacts/bossauto/` directory unless the user asks for another location.
- Save browser state under a workspace-local `runtime/profiles/` directory. Never store profiles inside the skill folder.
- When a persistent profile is already open in a user-controlled browser, do not try to control the same profile. Ask the user to close that browser or open a separate authorized profile before running controlled actions.
- Keep this skill portable across machines: avoid absolute user paths, local app paths, local account names, and project-specific root assumptions.
