# Task Modes

Use this reference when deciding what kind of BOSS recruiting task the user is asking for. Route the task before running scripts or changing page state.

## Mode Selection

Classify the request into one or more modes:

- `session_support`: login handoff, stuck login, network abnormal, browser/profile troubleshooting.
- `page_inspection`: identify current page, frames, selected job, visible controls, available filters, or candidate-card selectors.
- `recommendation_processing`: work from recommended candidates for the current job or recommendation context.
- `search_research`: use search pages to expand or study the candidate pool, usually before any paid or high-cost action.
- `filter_management`: inspect, compare, or explicitly apply BOSS filters.
- `detail_evidence`: open candidate details, capture text/screenshots, and verify identity.
- `screening`: compare BOSS evidence against recruiter requirements, a JD, or a criteria file.
- `follow_up`: inspect or manage existing chats, already-contacted candidates, or next-step lists.
- `collections_review`: inspect favorites/collections or a saved shortlist.
- `controlled_action`: favorite, collect, greet, contact, send, exchange, mark unsuitable, or any other website-changing action.
- `reporting`: produce tables, spreadsheets, summaries, or handoff artifacts.

If a request contains several modes, execute them in this order: inspect context, capture evidence, evaluate, then act only if authorized.

## Page Entry Guidance

Choose the page from the business goal, not from convenience:

- Recommendation pages are usually the first choice when the recruiter wants low-friction review of candidates already surfaced for a job.
- Search pages are appropriate for market research, expanding a sparse pool, or checking specific keywords, but they can have different cost and action semantics.
- Chat or follow-up pages are for existing conversations, duplicate-contact checks, and next-step management.
- Favorites or collections pages are for reviewing saved candidates, auditing prior actions, or preparing outreach lists.
- Job or posting pages are account-state pages. Treat job switching, posting edits, and job settings as page-state changes.

Do not refresh, switch jobs, reset filters, or change page type merely to make automation easier. Preserve the recruiter's current context unless the task requires a change.

## Cost And State Awareness

Before choosing a workflow, infer or verify:

- Whether the task optimizes for low-cost candidate operations, broad candidate discovery, follow-up efficiency, or reporting.
- Whether the current page contains a user-curated or platform-generated list that could change after refresh.
- Whether a page action can trigger a paid, limited, or irreversible workflow.
- Whether the user asked for inspection only, a recommendation, or a concrete website-changing action.

When in doubt, prefer read-only inspection and report the page context before acting.

## Mode-Specific Defaults

- `session_support`: read-only diagnostics; user handles login, CAPTCHA, MFA, and consent.
- `page_inspection`: no website-changing clicks except opening panels needed for inspection.
- `recommendation_processing`: avoid refresh; scroll/load more only when needed; dedupe by stable candidate keys.
- `search_research`: do not assume search candidates should be contacted; treat results as research until the user approves actions.
- `filter_management`: inspect first; apply only exact requested changes after approval.
- `detail_evidence`: save evidence and verify identity; identity mismatch becomes `review`.
- `screening`: use only BOSS evidence plus recruiter-provided criteria.
- `follow_up`: protect against duplicate contact; do not send or modify messages without explicit text and approval.
- `controlled_action`: load `controlled-actions.md`.
- `reporting`: load `reporting-and-structured-review.md`.

## Anti-Patterns

- Starting from the wrong page type because a previous task used that page.
- Treating a test instruction such as "first visible candidate" as a reusable targeting method.
- Turning a screening request into an action request without explicit approval.
- Treating a script's default URL, profile, or output path as the user's intended context.
- Encoding a role, keyword set, company list, or local machine path into the skill.
