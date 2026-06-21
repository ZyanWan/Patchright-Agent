# Batch Workflows

Use this reference before processing many candidates, running a target-count task, or combining screening with approved website-changing actions.

## Batch Planning

Before a batch run, define:

- Source page mode: recommendation, search, favorites, chat/follow-up, or current page.
- Target count or stopping rule.
- Criteria source: JD, recruiter requirements, criteria file, or prior shortlist.
- Allowed page-state changes: none, scrolling/loading only, filter changes, job changes, or other explicit changes.
- Allowed website-changing actions: none by default; list exact action types if approved.
- Output directory under a workspace-local runtime artifact path.
- Whether a small verification batch is required before scaling.

Do not encode role-specific keywords, local paths, account names, or browser executables into reusable scripts or docs.

## Recommended Sequence

1. Inspect current page context and selected job when visible.
2. Save a page diagnostic artifact.
3. If filters are involved, inspect current filter state before applying any changes.
4. Process a small verification batch in read-only mode, or with only the explicitly approved low-risk action.
5. Review action locator behavior and logs before scaling.
6. Process candidates in batches from visible fresh cards.
7. Deduplicate by stable candidate key.
8. Open details only when needed for evidence or action verification.
9. Save progress after every batch.
10. Run a final audit over counts, outputs, action logs, and forbidden actions.

## Candidate Identity

For every processed candidate, keep:

- Stable ID from BOSS when available.
- Local candidate key.
- Visible name or display label.
- Card text or structured card fields.
- Detail text path and screenshot path when opened.
- Decision, reason, and evidence coverage.

List order is not durable. It may be included for display but must not be the only action target.

## Evaluation Semantics

Use consistent decision values:

- `pass` or `consider`: evidence supports moving forward.
- `review`: evidence is incomplete, mixed, or needs recruiter judgment.
- `skip`: evidence conflicts with hard constraints or the candidate was intentionally skipped.
- `insufficient_evidence`: available evidence is too thin to judge.

If the batch also performs a website-changing action, keep `decision` and `action_status` separate.

## Controlled Batch Actions

Batch actions require explicit current authorization that includes:

- Action type.
- Targeting rule or approved shortlist.
- Scope limits such as page mode, target count, role/project, or current session.
- Any required message text for send/greet actions.

During execution:

- Re-locate and verify each candidate immediately before acting.
- Process one candidate at a time.
- Log every performed, skipped, already-done, failed, or ambiguous action.
- Stop on ambiguous action results, unexpected modals, payment prompts, or account restrictions.

Do not silently substitute another candidate when a target cannot be re-identified.

## Batch Contact Initiation

For `contact_init`, bulk execution is the normal workflow after the recruiter has approved a shortlist or current-session target rule. Use the dedicated batch script instead of looping the single-candidate script.

Dry-run from a current scan:

```bash
python <skill-dir>/scripts/batch_contact_candidates.py --profile runtime/profiles/bossauto-profile --url "<current-approved-source-url>" --candidates runtime/artifacts/bossauto/candidates.json --json runtime/artifacts/bossauto/batch-contact/summary.json
```

Apply after explicit approval:

```bash
python <skill-dir>/scripts/batch_contact_candidates.py --profile runtime/profiles/bossauto-profile --url "<current-approved-source-url>" --candidates runtime/artifacts/bossauto/candidates.json --apply --authorization "user approved contact_init for the current approved shortlist" --json runtime/artifacts/bossauto/batch-contact/summary.json
```

Behavior to expect:

- The script opens one persistent browser session and works through targets sequentially.
- It selects targets from `--targets-json`, or from uncontacted rows in a `scan_candidates.py` JSON when `--candidates` is supplied.
- Use the current approved source page URL. `/web/chat/interaction` is correct for interaction/favorites sources such as saved candidates, but it is not a universal batch-contact entry for recommendation or search sources.
- When `--candidates` comes from `scan_candidates.py`, the script can read the scan JSON's source URL. For target files without a source URL, pass `--url` explicitly before using `--apply`.
- It requires stable IDs for website-changing clicks; missing IDs are skipped rather than guessed.
- It re-locates each candidate immediately before acting and checks the visible name when available.
- It skips candidates with duplicate-contact signals such as `继续沟通`, `已沟通`, or `沟通记录`.
- It logs each performed, skipped, failed, or review-needed result and updates local decision records.
- It performs a final visible-card rescan so the report can verify whether the page now shows contacted states.

Keep `scripts/contact_candidate.py` for a single test target, a retry after human review, or a narrow debug case.

## Final Audit

A completed batch should verify:

- Candidate count matches the requested target or explain why it stopped early.
- Output files exist and can be parsed.
- Action log count matches the reported website-changing action count.
- Forbidden actions are absent unless explicitly authorized.
- Reports use readable encoding and recruiter-friendly fields.
- Sensitive artifacts remain in runtime output, not inside the skill package.

For spreadsheet outputs, include both an action/shortlist sheet and a full inspected-candidate sheet when useful.
