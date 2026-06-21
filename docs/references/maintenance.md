# Maintenance Reference

Use this checklist before cleanup or layout changes.

## Durable Content

Keep these unless the task explicitly asks for a redesign:

- `AGENTS.md`
- `README.md`
- `.editorconfig`
- `.gitignore`
- `skills/**/SKILL.md`
- `skills/**/scripts/`
- `skills/**/references/`
- `skills/**/assets/`
- `tools/validation/`
- `labs/**/src/`
- `labs/**/config/`
- `labs/**/scripts/`
- `labs/**/package.json`
- `labs/**/package-lock.json`
- `labs/**/README.md`
- `labs/**/SETUP.md`
- `labs/**/CLAUDE.md`

## Local Generated Content

These are normally safe to remove because they can be regenerated:

- `__pycache__/`
- `.pytest_cache/`
- `.mypy_cache/`
- `.ruff_cache/`
- `.cache/`
- `*.pyc`
- `*.pyo`
- `node_modules/`
- `out/`
- `dist/`
- `*.tsbuildinfo`
- temporary files such as `*.tmp`

## Sensitive Runtime Content

Do not delete these by default:

- `runtime/profiles/` - browser profiles, cookies, local storage, permissions, and login state.
- `runtime/artifacts/` - screenshots, JSON, reports, logs, and candidate evidence.
- `runtime/downloads/` - files downloaded during automation.

`runtime/artifacts/` and `runtime/downloads/` can be cleaned when the user confirms the evidence or downloads are no longer needed. `runtime/profiles/` should only be reset when login state is intentionally disposable.

## Layout Change Checklist

1. Move source and docs together.
2. Update `AGENTS.md`, `README.md`, and any affected skill references.
3. Scan for stale hardcoded local paths such as drive roots, user profiles, `.codex`, `.agents`, account names, and one-off candidate names.
4. Run the smallest relevant validation:
   - Generic browser changes: `python tools/validation/check_patchright_capabilities.py`
   - BOSS skill documentation changes: skill validator plus targeted script dry-runs where practical
   - Electron lab code changes: `npm run typecheck`
5. Re-scan for generated caches before finishing.
