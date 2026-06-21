# Skill Distribution

This project uses a public installer plus a private Skill source repository.

```text
public npm package:
  @zyanwan/patchright-agent-installer

private Skill source:
  ZyanWan/Patchright-Agent
```

There are two supported distribution paths:

1. Direct private GitHub install with `npx git+https://...`. This downloads this repository as the package and installs its bundled `skills/` directory.
2. Public npm installer package. This package does not contain private Skill content. It checks the local environment, uses GitHub CLI authentication, clones the private repository to a temporary directory, copies every valid skill under `skills/`, then removes the temporary clone.

## User Installation

The user must have access to the private GitHub repository.

```bash
npx -y git+https://github.com/ZyanWan/Patchright-Agent.git install codex
```

Public npm installer path:

```bash
gh auth login
npm install -g @zyanwan/patchright-agent-installer --registry=https://registry.npmjs.org/
patchright-agent-installer install codex
```

Claude Code:

```bash
npx -y git+https://github.com/ZyanWan/Patchright-Agent.git install claude
patchright-agent-installer install claude
```

Custom skills directory:

```bash
npx -y git+https://github.com/ZyanWan/Patchright-Agent.git install --target ~/.agents/skills
patchright-agent-installer install --target ~/.agents/skills
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
npx -y @zyanwan/patchright-agent-installer install codex --scope project
```

Use `--target` when the agent has a custom skills directory:

```bash
npx -y @zyanwan/patchright-agent-installer install --target /path/to/skills
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
- The installer does not bypass private repository permissions.
- The installer requires the user to authenticate with `gh auth login`.
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
