# Filter Sync

Use this reference before reading or changing BOSS page filters.

## Safe Order

1. Load a workspace-local criteria file.
2. Inspect the current page and save selected filter state.
3. Compare desired filters with current selected filters.
4. Ask for approval before using any option that changes page state.
5. Apply only exact label and option matches.
6. Click the page's confirm/apply control when the page requires it.
7. Verify the filter panel is closed before reading candidates or details.
8. Re-inspect and save the after-state.

Opening a filter panel for inspection is acceptable. Clicking options, confirm buttons, reset controls, job switches, or anything that refreshes the candidate list is a page-state change and requires an explicit current request.

## Panel Lifecycle

Recommendation-page filters are panel based. Selecting options is not enough; the page may apply them only after the confirm control is clicked. After confirming, the recommendation list can refresh and previous candidate indexes may no longer point to the same people.

Before any downstream candidate scan, detail read, favorite, collect, or contact action:

- Confirm the filter panel is closed.
- If the panel is still open, stop and report the filter state instead of reading candidate details.
- Do not treat text from an open filter panel as candidate-card or candidate-detail evidence.
- Re-scan candidates after a confirmed filter change; do not reuse stale card indexes from before the change.

## Supported Pattern

Recommendation-page filters are best handled as exact label plus exact option values:

```json
{
  "filters": {
    "recommend": {
      "<filter-label>": ["<exact-option>"]
    }
  }
}
```

Run read-only inspection first to discover the current page's exact labels and option text. The automation should not infer synonyms. If BOSS uses a different label or option text, report it and let the user update the criteria file.

When applying recommendation filters, the result should record:

- `before`: selected values before applying.
- `comparison`: exact label/option comparison.
- `applied`: option click results.
- `confirm`: whether the confirm control was found, clicked, and closed the panel.
- `after`: selected values after confirmation.

If the confirm control is missing, clicking fails, or the panel does not close, treat the apply step as failed.

## Search-Page Caution

Search pages use a mix of city inputs, dropdowns, sliders, and checkbox groups. Inspect search-page state first. Add automation only for the exact controls that were verified in the current page version.

If the page layout or labels differ from the known pattern, stop at diagnostics.
