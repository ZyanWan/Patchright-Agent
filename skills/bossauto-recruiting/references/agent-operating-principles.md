# Agent Operating Principles

Use this reference when a BOSS recruiting task is ambiguous, long-running, high impact, or could become too script-driven.

## Agent Responsibilities

The agent is responsible for the full recruiting automation loop:

1. Understand the user's business goal.
2. Inspect and preserve the current BOSS context.
3. Choose the least state-changing workflow that can satisfy the goal.
4. Collect evidence before judging candidates.
5. Separate judgment from website-changing actions.
6. Keep outputs auditable enough for a recruiter to review later.

Scripts are helpers. They do not replace agent judgment.

## Observe Before Acting

Before running a workflow that reads many candidates or changes the website, capture:

- Current BOSS page type and URL.
- Current job or recruiting context when visible.
- Active frame names and visible candidate-card selectors.
- Whether the current list appears generated, filtered, searched, saved, or conversational.
- Whether the task could be harmed by refresh, job switching, filter changes, or navigation.

If the current context conflicts with the user goal, explain the conflict or use a read-only diagnostic path.

## Evidence Discipline

Use only these sources for candidate facts:

- BOSS card text.
- BOSS detail text.
- BOSS screenshots or visual observations.
- Recruiter-provided JD, requirements, notes, or criteria files.
- Local decision/action records created by prior authorized workflows.

Do not infer missing education, company, title, availability, language skill, portfolio quality, or willingness to communicate.

When converting a JD or recruiter note into criteria, separate:

- Hard constraints.
- Preferences and bonus signals.
- Exclusion rules.
- Unknowns needing human review.
- Requirements that BOSS evidence cannot verify.

## Transparency During Long Runs

For long or batch tasks, keep the run inspectable:

- Save candidate JSON as the run progresses.
- Save event logs for major steps.
- Save detail text or screenshots used for judgments.
- Save action logs for every attempted website-changing action.
- Prefer small verification batches before scaling.

Do not wait until the end to create the only copy of the results.

## Stop Conditions

Stop or switch to human review when:

- Login, CAPTCHA, MFA, payment, account restriction, or unexpected confirmation appears.
- Candidate identity cannot be verified after opening details.
- A write action produces an ambiguous result.
- The visible page no longer matches the requested page type or job context.
- Several scroll/load attempts produce no new stable candidate keys.
- The task would require guessing a control, message, filter, or action target.

## Reporting Back

Final handoff should include:

- What page/mode was used.
- How many candidates or records were inspected.
- How many were passed, reviewed, skipped, or acted on.
- Which website-changing actions were performed, skipped, or not attempted.
- Where evidence, reports, and logs were saved.
- Any unresolved risks or human-review items.

Avoid presenting automation completion as proof of recruiting quality. Preserve evidence so the recruiter can audit the judgment.
