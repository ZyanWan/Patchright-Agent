# Criteria And Filters

Use this reference when turning recruiter requirements into reusable local configuration.

## Configuration Shape

Keep business rules in a workspace-local criteria file, not inside scripts. Use `assets/criteria.example.json` as the portable starting point.

The criteria file separates:

- `hard`: deterministic list-level checks.
- `filters`: BOSS page filter targets for inspection or explicit synchronization.
- `model_gates`: optional model stages and the evidence each stage may use.
- `run_plan`: dry-run defaults, batch size, and action scope.

Do not store account names, local paths, cookie values, API keys, or candidate private notes in the template.

## Deterministic Rule Semantics

Apply hard rules conservatively:

- `skip_contacted`: skip cards whose visible text shows already-contacted, continue-chat, greeted, exchanged, or similar states.
- `forbid_company_keywords`: reject only when `companyText` clearly contains one of the keywords.
- `allow_company_keywords`: pass company quick-check only when a keyword is clearly visible; absence is not rejection.
- `title_block_keywords`: reject only when `titleText` clearly contains one of the keywords.
- `title_allow_keywords`: mark as list-pass evidence when visible; absence should continue to review or model gates.
- `education_required_any`: reject only when education text is available and clearly contains none of the required values.

Missing fields route to `review`, not `reject`, unless the user explicitly made missing evidence disqualifying.

## BOSS Filter Targets

Use filter synchronization as a page-state operation, not as candidate screening by itself.

- Run inspect/dry-run first and save JSON evidence.
- Apply filters only when the user explicitly asks to change BOSS page filters.
- After applying, re-inspect and compare selected values with the criteria file.
- If a target label or option is not found, stop and report the mismatch instead of guessing nearby labels.

Recommendation-page filters are usually chip-like options under a filter panel. Search-page filters can use city fields, dropdowns, sliders, and checkbox groups, so inspect support is safer than broad automatic mutation.

## Model Gates

Keep model gates separated by evidence type:

- Company gate: only `companyText`.
- Title gate: only `titleText`.
- Detail gate: saved detail text, screenshots, or OCR output.

Require strict structured output from any model. Parse failures, uncertainty, and extraction mismatch become `review`.
