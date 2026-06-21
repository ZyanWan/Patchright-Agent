# Screening Funnel

Use this reference when an agent helps a recruiter move from visible BOSS candidate cards to evidence-based screening decisions.

## Funnel Order

Prefer this order:

1. Identify the task mode and source page. Load `task-modes.md` if the page choice has business consequences.
2. Scan visible candidate cards and collect stable IDs plus list evidence.
3. Skip candidates already contacted or already processed for the current role/project when that is visible and relevant.
4. Apply deterministic list checks only when the card evidence is clear.
5. Use a model or human review for ambiguous company or role relevance, but bias toward review/pass when uncertain.
6. Open detail only for candidates that pass list-level checks or need more evidence.
7. Extract and save the detail evidence used for evaluation.
8. Record a local decision before taking any website-changing action.
9. Take write actions only with explicit current user approval.

## Deterministic Checks

Use code or explicit recruiter rules for clear list-level checks such as:

- Already contacted or already greeted.
- Required/forbidden education signals when visible.
- Required/forbidden experience range when visible.
- Current-company allow/block lists supplied by the user.
- Role-title allow/block lists supplied by the user.

Only reject at the list level when the evidence is clear. Missing or partial card fields should route to detail review rather than rejection.

When criteria come from a JD or recruiter notes, split them before judging:

- Hard constraints.
- Preferences and bonus signals.
- Risk factors.
- Unknowns needing human review.
- Requirements that BOSS evidence cannot verify.

## Model Gates

When using a model before opening detail, separate gates by evidence type:

- Company gate: judge company/type only. Do not use role, skills, city, salary, or school.
- Role gate: judge coarse role relevance only. Do not judge performance, company desirability, school, salary, or detailed fit.
- Detail gate: judge against the recruiter's criteria using saved detail evidence.

For every model gate, use strict structured output and treat parse failures as `review` or `maybe`, not `reject`.

## Detail Judging

For candidate details:

- Evaluate only observable evidence from the card, detail text, screenshots, or user-provided criteria.
- Save the exact text/screenshot sent to any model.
- Separate evidence extraction from final decision: first identify facts, then compare them with criteria.
- Use `review` when facts are missing, extraction is suspect, or the identity check fails.

Do not invent missing work history, education, metrics, or dates. Do not reject because a useful field is absent unless the user explicitly made that absence disqualifying.

If the current agent has visual capability and detail evidence contains screenshots or image-rendered resume content, use `vision-review.md` before OCR. Keep visual observations tied to the screenshot artifact.

## Dry Run First

Run screening workflows in inspection/dry-run mode first:

- Save candidate JSON and decisions locally.
- Summarize counts: scanned, skipped, rejected, reviewed, passed.
- Ask for approval before any favorite/contact/greet/send action.

Promote a workflow from dry-run to website-changing actions only after the user reviews the evidence and approves the exact action scope.

For large or target-count tasks, load `batch-workflows.md`. A small verification batch is preferred before scaling, especially when the run will later perform approved actions.
