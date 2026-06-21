# Controlled Actions

Use this reference before any BOSS action that changes website state, including favorite/collect/save, contact initiation, send message, exchange contact information, mark unsuitable, or similar actions.

## Default

Default to read-only. A high-quality candidate recommendation is not authorization to act. A user request to scan, screen, summarize, evaluate, or rank candidates is not authorization to act.

Website-changing actions have different risk levels:

- Lower-risk candidate state markers: `favorite`, `collect`, `save`.
- Outreach or communication actions: `contact_init`, `greet`, `contact`, `open_continue_chat`, `send_message`, `continue_chat`.
- Contact-data or platform-sensitive actions: `exchange_contact`, phone/WeChat related actions, paid or limited actions.
- Negative or irreversible actions: `mark_unsuitable`, hide, block, delete, archive, or similar.

Use stricter confirmation and stop conditions as action risk increases. Never infer approval for a higher-risk action from approval for a lower-risk action.

## Authorization Gate

Proceed only when the current user prompt explicitly authorizes a concrete website-changing action.

Valid authorization must include:

- The action type, such as `favorite`, `collect`, `contact_init`, `send_message`, `exchange_contact`, or `mark_unsuitable`.
- The target scope: specific candidate keys, stable IDs, names plus evidence, or an approved shortlist generated in the current task.
- Any message text when manual sending requires editable text. Contact initiation does not authorize typing, editing, or manually clicking `发送`, but the platform may automatically send the recruiter's preconfigured greeting after the contact button is clicked.

If the user says "contact high-quality candidates" or similar, first convert the AI recommendation into a confirmation checklist and ask for confirmation before clicking. For many approved targets, treat batch contact initiation as the primary execution mode instead of launching one browser session per candidate.

For batch actions, authorization can name a rule-generated shortlist instead of listing every candidate individually, but the rule must be grounded in current-session evidence and recruiter criteria. Keep the targeting rule, run scope, and action type in the action log.

## Candidate Selection

Only act on candidates that satisfy all of these:

- Candidate identity is tied to a stable key, stable ID, or explicit visible card text.
- Evidence comes from BOSS card/detail data plus HR/JD requirements.
- The candidate is in the approved shortlist or explicitly named by the user.
- There is no visible already-contacted, continue-chat, already-greeted, exchanged, or similar duplicate-contact signal unless the user explicitly approves a follow-up or only asks to inspect/open an existing conversation.
- The action is scoped to the visible intended candidate/detail container, not a global page search.

Do not act on candidates whose identity is `review`, whose detail screenshot appears to belong to another person, or whose list position shifted after refresh.

## Target Freshness

BOSS recommendation and search lists can refresh between browser launches, after filtering, or after opening and closing details. A controlled action must target a specific candidate identity, not a stale list position.

Before acting:

- Prefer an approved target with a stable ID, local candidate key, visible name, and supporting card/detail evidence.
- Re-locate the target in the current session and verify that the stable ID, visible name, and card/detail evidence still match the approved checklist.
- If the approved shortlist was created in an earlier run, re-scan or re-open evidence before acting.
- Do not use a previous list index as a durable target. List indexes are for display, diagnostics, or ad hoc tests only.
- Log the resolved candidate identity after execution so the user can audit which person was actually affected.

If the target cannot be re-identified, fail closed and log `failed` or `skipped`; do not choose another candidate silently.

## Profile Ownership

A persistent browser profile can be owned by only one running browser. If the user's visible browser already has the target profile open, automation may fail or close immediately.

Before controlled actions:

- Check whether the profile is already open when the environment exposes process/profile state.
- If the profile is occupied, ask the user to close that browser, or use a separate authorized profile.
- Do not switch to coordinate clicking in the user's live browser to bypass profile ownership; it is too easy to click the wrong candidate or action.

## Confirmation Checklist

Before acting, present a concise checklist and wait for user confirmation unless the current user prompt already contains both the exact action and exact target list or an exact current-session batch scope.

Checklist fields:

- Candidate key or stable ID.
- Candidate name.
- Proposed action.
- Evidence summary from BOSS card/detail.
- HR/JD reason for selection.
- Duplicate-contact status.
- Risks or review flags.
- Message text, if any.

Example structure:

```json
{
  "proposedAction": "favorite",
  "targets": [
    {
      "candidateKey": "stable-or-local-key",
      "name": "visible name",
      "reason": "evidence-based shortlist reason",
      "duplicateContactStatus": "none_visible | already_contacted | unknown",
      "reviewFlags": []
    }
  ],
  "requiresUserConfirmation": true
}
```

For authorized batch actions, the checklist can be a run-level plan plus sample targets:

```json
{
  "proposedAction": "favorite",
  "sourcePageMode": "recommendation",
  "targetingRule": "candidates that satisfy current recruiter criteria after evidence review",
  "scopeLimit": "current session or explicit target count",
  "dryRunOrSampleFirst": true,
  "logPath": "runtime/artifacts/bossauto/action-log.jsonl",
  "requiresUserConfirmation": true
}
```

## Execution Rules

- Re-scan or re-locate the candidate immediately before acting.
- Prefer stable ID targeting. Fail closed if the stable ID is not visible.
- Verify that the re-located candidate still matches the approved confirmation checklist.
- Scope the action locator to the candidate card or visible detail panel that belongs to the approved candidate.
- Match action labels exactly or by a narrow synonym set appropriate to the requested action.
- For `contact_init`, click only a scoped `沟通`, `打招呼`, or `立即沟通` button and then stop after verification. Treat this as outreach because BOSS may automatically send the recruiter's preset greeting. Do not type into chat boxes, click `发送`, trigger SMS/phone/priority reminders, or exchange contact data.
- For `send_message`, do not invent message text. Use only user-provided text or ask for it. This skill does not currently automate message sending by default.
- If a modal, prompt, CAPTCHA, login, payment, restriction, or unexpected confirmation appears, stop and hand control to the user.
- If multiple candidates are approved, use the batch contact-initiation workflow when the requested action is `contact_init`; otherwise process one candidate at a time and log each outcome before continuing.
- Do not click broader action labels by searching the whole page. Scope action locators to the verified candidate card, detail panel, or chat context.
- Do not upgrade the action. Approval to favorite is not approval to greet; approval to greet is not approval to send a custom message unless message text is supplied.

## Action Log

Log every attempted website-changing action, including skipped or failed actions. Store logs under a workspace-local runtime artifact path unless the user chooses another project data directory.

Recommended JSONL fields:

```json
{
  "timestamp": "ISO-8601 timestamp",
  "candidateKey": "stable-or-local-key",
  "stableId": "BOSS stable id when available",
  "name": "visible candidate name",
  "action": "favorite | collect | contact_init | greet | contact | open_continue_chat | send_message | exchange_contact | mark_unsuitable",
  "status": "planned | performed | skipped | failed | needs_review | user_cancelled",
  "authorization": "short description of the current user approval",
  "reason": "evidence-based reason",
  "evidenceArtifacts": [],
  "url": "page or candidate URL when available",
  "messageTextHash": "optional hash when message content should not be stored",
  "error": ""
}
```

Write action logs append-only. Do not erase prior logs during a run.

For batch runs, also record:

- The task mode and source page.
- The criteria or shortlist rule.
- Whether the action was already done before the run.
- The artifact paths that supported the action decision.

After a batch run, audit the log for unapproved action types before reporting success.

## Post-Action Records

After a performed write action:

- Update the local action log.
- Record a decision such as `favorite` or `contacted` in the relevant local record file. A successful `contact_init` can be recorded as `contacted`, but the reason should say that only the initial contact button was clicked, any greeting was platform-preconfigured, and subsequent chat is manual.
- Treat contacted/greeted/exchanged actions as global duplicate-protection signals across projects.
- Summarize exactly what was performed and what was skipped or failed.

Do not continue to another candidate if the prior action produced an ambiguous result. Stop and ask for human review.

## Favorite/Collect Actions

Use `scripts/favorite_candidate.py` for a single approved favorite/collect-style test when possible.

- The script defaults to dry-run and only clicks when `--apply` is supplied.
- Use `--stable-id` for the approved candidate. Include `--candidate-name` when available as an extra identity check.
- Save before/after screenshots and the JSON result when testing or auditing.
- After a successful click, call `record_action_log.py` and `record_decision.py` to persist the action outcome.

## Contact Initiation

Contact initiation means the agent clicks the approved candidate's scoped `沟通`, `打招呼`, or `立即沟通` button. BOSS may automatically send the recruiter's preconfigured greeting when that button is clicked. The agent does not compose, edit, manually send, text, call, use priority reminders, or exchange contact information.

- Require explicit approval for the action type and target scope.
- Check duplicate-contact signals before acting.
- On favorites/interaction pages, scope to the approved candidate card.
- On recommendation/search/detail workflows, scope to the visible candidate detail container, not the whole list page.
- Treat a post-action `继续沟通`, `已沟通`, `沟通记录`, visible matching chat panel, or similar state as success for contact initiation only.
- If the page opens a chat panel after contact initiation, do not continue with the conversation; report that manual recruiter follow-up is needed.
- Stop on paid prompts, quota prompts, account restrictions, or unexpected confirmation dialogs.
- Log `contact_init` when the only automated action was clicking the initial contact button, even if the platform auto-sent a preset greeting. Reserve `send_message` for a separately approved future workflow where the agent actually types, edits, or manually sends text.

## Batch Contact Initiation

Use `scripts/batch_contact_candidates.py` when a user approves contact initiation for multiple saved, recommended, searched, or shortlisted candidates.

Recommended flow:

1. Scan the current page or load the approved shortlist artifact.
2. Produce a dry-run plan with `batch_contact_candidates.py` and confirm the action scope unless the current prompt already authorized the exact current-session batch.
3. Run with `--apply --authorization "<approval summary>"` only after approval.
4. Let the script re-locate each candidate by stable ID plus visible name, skip already-contacted candidates, click only scoped contact-initiation buttons, and write per-candidate results.
5. Review the final summary, after-scan, action log, and decision records before reporting completion.

Batch-specific rules:

- Prefer `--candidates` for the current scan JSON or `--targets-json` for an explicitly approved shortlist.
- Do not use list position alone as a target. A list index is only a display hint.
- Stop on `failed` or `needs_review` by default. Use `--continue-on-error` only when the user has accepted that risk for the batch.
- Use `--screenshots` when the user needs stronger audit evidence, but do not require screenshots for every routine batch if JSON logs are sufficient.
- Do not implement batch contact by shell-looping the single-candidate script unless debugging. The batch script keeps one browser session open, avoids repeated profile contention, and gives one final audit.

## Message And Contact-Data Actions

Message sending, SMS, phone tools, priority reminders, WeChat/phone exchange, and similar contact-data actions are outside the default automated workflow.

- Do not treat approval to `contact_init` as approval to type a custom message, manually send, or continue chatting.
- Do not click `发送短信`, phone icons, `优先提醒Ta`, exchange/contact-data buttons, or a chat `发送` button unless a future task defines an explicit stricter workflow and the user approves that exact action.
- Opening a `继续沟通` panel for inspection is lower risk than sending, but it is still a website interaction; keep it read-only and hand control to the recruiter after observation.
