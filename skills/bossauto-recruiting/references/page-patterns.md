# BOSS Page Patterns

Use this reference for BOSS recruiting page inspection, candidate-card scanning, and detail extraction.

## Page Types

- Search pages commonly include `/web/chat/search` and use a list frame named `searchFrame`.
- Recommendation pages commonly include `/web/chat/recommend` and use a list frame named `recommendFrame`.
- Interaction/favorites pages commonly include `/web/chat/interaction` and use a list frame named `interactionFrame`. The `收藏牛人` tab is a saved-candidate pool where candidate cards can expose `沟通` or `继续沟通` actions.
- Other recruiting or chat pages can still be useful for status checks, but avoid assuming candidate-card selectors are available.

## Frame Selection

Select the target frame by URL first, then frame name:

- Search: prefer `searchFrame`.
- Recommend: prefer `recommendFrame`.
- Interaction/favorites: prefer `interactionFrame`.
- Fallback: inspect all frames and choose the first one with visible candidate-card selectors.

Do not use `contentDocument` for frame access. Use Patchright `page.frames` and frame locators.

When multiple BOSS tabs are open, prefer the visible tab whose URL matches the requested task. If visibility is unclear, stop and ask the user to bring the intended search or recommendation page to the front before taking actions. Do not run a task against a background tab by guessing.

## Candidate Cards

Known candidate-card selectors include:

- `li.geek-info-card`
- `div.candidate-card-wrap`
- `li.card-item div.candidate-card-wrap`
- `li.card-item`
- `.geek-item`
- `.candidate-card`

Filter out invisible or template-like nodes by checking bounding boxes. A candidate card should have non-trivial width and height.

Apply selectors as an ordered priority list and use the first selector that yields visible cards in the target frame. Do not merge all selectors into one broad locator unless the task is only diagnostics; merged selectors can double-count or mix list cards with stale/detail fragments.

Interaction/favorites pages can expose nested card-like nodes. For scans on `收藏牛人`, dedupe by `data-geek`, `data-geekid`, `data-lid`, or a local hash of the full visible card text when no stable ID exists. Do not treat outer and inner matches as separate candidates.

## Stable Candidate IDs

Prefer stable IDs from the card or its children:

- `data-geek`
- `data-geekid`
- `data-lid`

Avoid using `data-jid` as the candidate identity. It can represent a job ID, causing multiple candidates in the same list to collapse to the same target.

Use card index only for display order or diagnostics. Do not use it as the only click target for controlled actions. Before a website-changing action, resolve the candidate to a stable ID or auditable local candidate key and verify the visible evidence still matches the approved target.

When clicking a candidate, locate by the stable ID and fail closed if the ID is missing or no longer resolves. Do not fall back to `nth(index)` after opening and closing details because virtualized lists can shift and point to a different candidate.

Prefer clicking a name/title area inside the stable-ID card rather than a whole card region when write-action buttons share the card. Avoid the card's right-side action buttons unless the user approved that exact write action.

## List Evidence Fields

Collect separate list-level fields before opening details:

- `companyText`: current and recent companies when visible.
- `titleText`: expected role plus work-experience role names when visible.
- `educationText`: school, major, and degree snippets when visible.
- `text`: the full visible card text for audit and fallback hashing.

Use list evidence for deterministic gates and deduplication, but keep uncertain candidates moving to detail review instead of rejecting them from partial card text.

## Contacted Signals

Treat visible text such as already-contacted, continue-chat, greeted, exchanged, or chatted states as a skip signal unless the user explicitly asks to inspect those candidates.

Keep the text matching broad and evidence-based because labels can vary by page.

Common duplicate-contact signals include `已沟通`, `沟通记录`, `继续沟通`, `已打招呼`, `已联系`, `已交换`, and `聊过`. A `继续沟通` button means an existing conversation/contact channel is already present; it is not a prompt to automate further chat.

## Contact Initiation Buttons

Contact initiation is a candidate-scoped write action:

- On interaction/favorites pages, click `沟通` only inside the approved candidate card.
- On recommendation/search detail workflows, click `打招呼`, `立即沟通`, or equivalent buttons only inside the opened candidate detail container.
- Never find the first global `沟通`, `打招呼`, or `立即沟通` button on the page.
- Before clicking, verify the candidate stable ID or local key plus visible name/card evidence still matches the approved target.
- After clicking, success means the button or detail state changes to `继续沟通`, `已沟通`, `沟通记录`, or a matching chat panel opens. BOSS may also auto-send the recruiter's preset greeting; success does not mean the agent composed, edited, or manually sent custom text.
- If a post-click chat or continue-chat panel opens, stop automation there. Chat input, `发送`, SMS, phone, priority-reminder, and contact-exchange controls are separate higher-risk actions for manual recruiter handling unless a future task defines a stricter approved workflow.

On interaction pages, `继续沟通` usually opens an in-page conversation panel while the URL may remain `/web/chat/interaction`. Treat this as existing-contact inspection, not as fresh outreach.

## Detail Extraction

When opening candidate details:

- Verify that the detail belongs to the intended candidate when the card exposes a name or stable identity.
- Prefer DOM text when available.
- If text is canvas-rendered or incomplete, save a screenshot and mark for human review rather than inventing missing resume content.
- When extraction fails or the candidate identity is suspect, do not mark the candidate as definitively rejected.
- Save the exact detail text or screenshot that was used for evaluation when practical. This makes it possible to audit wrong-person reads, extraction gaps, and model reasoning.
- If the opened detail text does not include the candidate name from the card, retry extraction once. If it still does not match, record `review` with evidence instead of taking a write action.

For actions inside an opened detail panel, scope locators to a visible detail container such as resume/detail/candidate/geek containers. Do not search the whole page for "greet", "favorite", "contact", or similar buttons because list cards may contain buttons for other candidates. This detail-container scoping is essential for contact initiation: list buttons and detail buttons can coexist.

## Scrolling And Batches

Process candidates in batches from the current visible list:

- Keep an in-memory `processedKeys` set for the current run so dry runs do not repeatedly process the same visible candidates.
- Scroll or load more only after the current fresh visible candidates are handled.
- Treat several consecutive rounds with no new candidate keys as the end of the current list.
- If BOSS shows a boundary such as no more suitable candidates and then more generic recommendations, stop the precise task rather than processing lower-quality spillover cards.

## Source Reference

These patterns come from field-tested Patchright recruiting automation: frame-aware candidate scanning, stable ID targeting, detail extraction, and duplicate protection. Treat them as implementation guidance, not as code to copy wholesale into this portable skill.
