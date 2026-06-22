# Skill Distribution

This project distributes bundled Agent Skills through the public npm installer.

```text
public npm package:
  @zyanwan/patchright-agent-installer@0.2.0
```

The current team installation path is npm-only. Use the fixed `0.2.0` version and the explicit `--source patchright-agent-installer/skills` argument so the installer reads from the skills bundled inside the npm package and does not clone GitHub.

## User Installation

Codex:

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install codex --source patchright-agent-installer/skills
```

Update an existing Codex install:

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install codex --source patchright-agent-installer/skills --force
```

Claude Code:

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install claude --source patchright-agent-installer/skills
```

Custom skills directory:

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install --target ~/.agents/skills --source patchright-agent-installer/skills
```

## Target Paths

Default install roots:

```text
codex user  -> ~/.agents/skills
codex local -> ./.agents/skills

claude user  -> ~/.claude/skills
claude local -> ./.claude/skills
```

Use `--scope project` to install into the current working directory:

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install codex --scope project --source patchright-agent-installer/skills
```

Use `--target` when the agent has a custom skills directory:

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install --target /path/to/skills --source patchright-agent-installer/skills
```

## Publishing The Public Installer

The installer source lives in `installer/`.

Before publishing, confirm the npm scope and package name in `installer/package.json`.

```bash
cd installer
npm publish --access public
```

If the npm scope `@zyanwan` is not available, rename the package before publishing and update the README commands.

## Safety Model

- The installer does not include GitHub tokens.
- The documented npm installation path does not require GitHub authentication or repository cloning.
- The installer installs only directories under `skills/` that contain `SKILL.md`.
- Existing installed skills are not overwritten unless `--force` is provided.
- With `--force`, existing skill directories are backed up before new copies are installed.

## Maintainer Test Commands

Run from this repository:

```bash
node installer/bin/patchright-agent-installer.js help
node installer/bin/patchright-agent-installer.js install codex --dry-run
node installer/bin/patchright-agent-installer.js doctor
```
