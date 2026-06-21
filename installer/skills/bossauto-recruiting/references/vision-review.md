# Vision Review

Use this reference when BOSS candidate detail evidence includes screenshots, image-rendered resume content, canvas-rendered content, or other visual evidence that is not reliably available as DOM text.

## Role In The Workflow

`extract_detail.py` remains the capture step. It opens the intended visible candidate, saves a screenshot, saves available DOM text, records frame and canvas diagnostics, and writes a JSON evidence file.

This reference is the interpretation step. Do not use it before detail evidence has been captured and candidate identity has been checked as far as the page allows.

## Decision Order

1. Load the detail JSON from `extract_detail.py` and inspect:
   - `identity.status`
   - `matchedCardText`
   - `textPath`
   - `screenshot`
   - `canvasDetected`
   - `frames`
2. If `identity.status` is `review`, the text is very short, or the screenshot appears to show a different candidate, stop and mark the candidate for human review.
3. If the current agent can inspect images, review the saved screenshot directly before running OCR.
4. If the current agent cannot inspect images, or the runtime does not expose image inspection, use OCR only when an OCR tool or command is already available or explicitly approved by the user/operator.
5. If neither image review nor OCR is available, preserve the screenshot and mark the candidate as `insufficient_evidence` or `review`.

## Vision-First Review

When the agent can inspect screenshots:

- Open the saved screenshot from the evidence JSON.
- Confirm the visible candidate identity when possible, especially candidate name and the top detail header.
- Extract only visible facts relevant to the user's requested screening task.
- Treat visual observations as evidence with source `boss_detail_screenshot`.
- Do not infer hidden fields, unavailable salary expectations, unseen experience, unseen education, or unstated skills.
- If the screenshot is clipped, blurred, stale, unreadable, or shows the wrong candidate, mark for human review instead of guessing.

For structured outputs, record observations separately from DOM text:

```json
{
  "source": "boss_detail_screenshot",
  "artifact": "path from extract_detail.py JSON",
  "claim": "candidate fact or review observation",
  "quoteOrObservation": "visible text or concise visual observation",
  "confidence": "high | medium | low"
}
```

## OCR Fallback

OCR is a fallback, not the preferred path when the agent has reliable image understanding.

Use OCR only when:

- The current agent cannot inspect images.
- The user asks for machine-readable text from visual resume content.
- An OCR mechanism is available in the current environment or the user explicitly approves one.

Do not hardcode OCR engine names, executable paths, cloud providers, API keys, or local app paths in this skill. Choose the available OCR mechanism at runtime and document what was used in the output artifact.

Keep OCR output separate from DOM text:

```json
{
  "source": "ocr",
  "sourceArtifact": "screenshot or crop path",
  "engine": "runtime-provided OCR identifier",
  "text": "OCR result",
  "quality": "good | mixed | poor",
  "warnings": []
}
```

If OCR quality is mixed or poor, use the text only for search/review assistance and keep the hiring decision as `review` or `insufficient_evidence`.

## Evidence Priority

Prefer sources in this order:

1. Verified detail screenshot reviewed by a vision-capable agent.
2. Detail DOM text with matching candidate identity.
3. OCR text from the saved detail screenshot or focused crop.
4. Candidate-card text.
5. Recruiter-provided JD or requirements, only as criteria.

The JD or recruiter requirements are never evidence about a candidate. They are only the basis for matching decisions.

## Review Flags

Add review flags when any of these occur:

- `identity.status` is `review`.
- Candidate name is absent from detail text and cannot be visually confirmed.
- Screenshot and card appear to describe different people.
- The page contains canvas content but no usable screenshot review or OCR.
- OCR text conflicts with DOM text or visible screenshot content.
- Required screening fields are missing, hidden, or unreadable.

Do not perform website-changing actions based only on uncertain visual or OCR evidence.
