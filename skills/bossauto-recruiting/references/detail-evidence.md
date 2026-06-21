# Detail Evidence

Use this reference when opening BOSS candidate detail pages or reading resume evidence.

## Detail Strategy

Open details only after list-level checks show the candidate is worth inspection or needs more evidence. Prefer stable candidate IDs from the scanned card.

For every opened detail:

- Save the exact DOM text that was available.
- Save a screenshot of the opened detail state.
- Detect whether the detail contains canvas-rendered content.
- Verify whether the saved text includes the candidate name when a name is available.
- Mark identity mismatches, short text, or unreadable canvas-only content as `review`.

Do not use extracted text as final truth unless the extraction method and candidate identity are clear.

## Canvas-Rendered Resumes

BOSS detail content can be rendered in nested pages such as `c-resume` and may be canvas-based. DOM text can be empty or contain surrounding noise rather than the resume body.

Do not assume these approaches work:

- Direct body text from all frames.
- Late `addInitScript` or canvas `fillText` hooks.
- Global text search across the whole page.

If canvas content is detected:

- Save canvas images or a focused screenshot for audit.
- Prefer the vision-first workflow in `vision-review.md` before running OCR.
- Use OCR as a fallback when the current agent cannot inspect the screenshot or when visual review is unavailable.
- Keep visual observations and OCR text separate from DOM text and record each source.
- Use human review when OCR quality is uncertain.

## Identity Check

If the card has a candidate name:

- Treat a detail text that includes the name as stronger evidence.
- Retry extraction once when the name is missing and the detail appears short or stale.
- If the name is still missing, record `review` instead of rejecting or taking a website-changing action.

Do not fall back from a stable ID to a list index after detail navigation unless the user accepts the risk.
