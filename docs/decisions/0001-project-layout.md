# Decision 0001: Project Layout

## Status

Accepted.

## Context

The project contains reusable browser automation skills, BOSS-specific recruiting automation, a reference Electron implementation, local browser profiles, generated screenshots, JSON reports, logs, and validation tools. These assets have different lifecycles and safety requirements.

## Decision

Use this structure:

- `skills/` for reusable skill packages.
- `labs/` for reference implementations and experiments.
- `tools/` for validation and maintenance utilities.
- `runtime/` for local state, profiles, downloads, and generated evidence.
- `docs/` for project-level notes, references, and decisions.

The generic `patchright-browser` skill must stay independent of BOSS-specific selectors, URLs, page flows, and recruiting assumptions. BOSS-specific behavior belongs in `skills/bossauto-recruiting/` or the Electron lab.

## Consequences

- Agents can load a small, relevant surface instead of scanning the whole project.
- Runtime data is easier to keep out of reusable skill packages.
- Generated outputs can be cleaned without touching source code.
- New skills can be added under `skills/` without changing the browser automation foundation.
