# Patchright-Agent

Patchright-Agent is a reusable Agent Skills project for real-browser automation. It packages Patchright-powered browser control, persistent sessions, page probing, controlled actions, evidence capture, task scripts, and workflow references so AI agents can operate real web applications in a repeatable and inspectable way.

The project is designed as a skill layer for multiple agents rather than a single-purpose automation script. Domain workflows can be added as separate skill modules, while the core browser automation capability remains generic and portable.

## Skills

Reusable skills live under `skills/`. Each child directory is installed as one Agent Skill when distributing this project.

```text
skills/
  patchright-browser/
    SKILL.md
  bossauto-recruiting/
    SKILL.md
```

## Installation

### Recommended: Public npm installer

The npm package bundles all skills. Use the fixed `0.2.0` command below and keep the explicit `--source` value so installation reads from the bundled skills directory and does not clone GitHub.

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install codex --source patchright-agent-installer/skills
```

### Supported targets

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install codex --source patchright-agent-installer/skills
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install claude --source patchright-agent-installer/skills
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install --target <path> --source patchright-agent-installer/skills
```

To update an existing installation, add `--force`:

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install codex --source patchright-agent-installer/skills --force
```

### Advanced: Install from local repository

If you already have this repository cloned locally, run the installer from the repo root:

```bash
npx -y . install codex
```

See `installer/README.md` for full options (`--ref`, `--force`, `--dry-run`, etc.) and `docs/distribution.md` for publishing details.
