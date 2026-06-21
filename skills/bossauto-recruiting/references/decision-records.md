# Decision Records

Use this reference when recording candidate screening state.

## Record Goals

Decision records should support:

- Avoiding repeated work on the same visible candidate.
- Avoiding duplicate contact across projects when a candidate was already contacted.
- Preserving evidence and reasons for human review.
- Separating uncertain extraction failures from real screening rejections.

## Recommended Structure

Use workspace-local JSON files under `runtime/artifacts/bossauto/` unless the user gives a project-specific data directory.

For lightweight use, one JSON object keyed by candidate key is enough:

```json
{
  "candidate-key": {
    "decision": "review",
    "reason": "needs manual verification",
    "ts": 1710000000,
    "source": "agent"
  }
}
```

For longer-running recruiting workflows, split records:

- Global contacted record: candidates who were contacted, greeted, favorited, or otherwise acted on.
- Project screening record: rejected, skipped, reviewed, or evidence-extracted candidates for a specific role/project.

Keep the split strict:

- A write action such as contacted, greeted, favorited, or collected should protect the candidate globally across projects.
- A screening outcome such as reject, review, skip, or extraction-failed should normally apply only to the current role/project.
- A `review` or extraction-failed record should not permanently suppress the candidate; allow a later retry when page extraction improves or the user asks to re-check.

If record files are corrupt or fail to parse, stop writing rather than treating them as empty. Replacing a damaged history with `{}` can erase duplicate-contact protection.

## Candidate Keys

Prefer a stable key built from observable fields:

- Candidate stable ID if available.
- Candidate name plus education fields when visible.
- Candidate name plus a short hash of stable card text when education is missing.

Do not use name alone. It can merge different candidates.

Do not use `data-jid` as the candidate key. It can be a job identifier rather than a candidate identifier.

For visible-list runs, keep both:

- `stableId`: the best observable BOSS ID, if one exists.
- `key`: the deduplication key used by local records.

This makes click targeting and local duplicate protection auditable separately.

## Decision Values

Use concise values that distinguish confidence:

- `pass`: evidence supports moving forward.
- `reject`: evidence clearly fails criteria.
- `review`: human review required.
- `skip`: intentionally skipped, for example already contacted.
- `contacted`: a contact-initiation write action was performed with explicit user approval, or equivalent contacted state was confirmed.
- `favorite`: a favorite/save action was performed with explicit user approval.

Extraction failures, identity mismatches, or unreadable details should become `review`, not `reject`.

Use `check` or `review` for transient failures, identity mismatches, and details that do not include the card candidate's name. Do not let those records block all future review unless the user explicitly wants that behavior.

When logging contact initiation, keep the meaning narrow: the agent clicked an approved `沟通`, `打招呼`, or `立即沟通` button and verified an already-contacted state such as `继续沟通` or `沟通记录`. BOSS may auto-send the recruiter's preconfigured greeting after this click; record it as `contact_init`/`contacted`, not `send_message`, unless a separate workflow actually typed, edited, or manually sent recruiter-provided text.

## Evidence

When practical, store:

- URL
- card text
- detail text path
- screenshot path
- evaluation reason
- timestamp

Keep records local unless the user explicitly asks to export or share them.

Write records atomically for longer-running workflows: write to a temporary file in the same directory, then rename over the target. This avoids half-written JSON when a run is interrupted.

For controlled website-changing actions, pair the decision record with an append-only action log entry. The decision record is useful for duplicate protection; the action log is the audit trail of what was attempted, what happened, and which user approval authorized it.
