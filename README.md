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

### Recommended: Public npm installer (zero dependencies)

The npm package bundles all skills  no GitHub authentication, no Git clone required.

```bash
npm install -g @zyanwan/patchright-agent-installer
patchright-agent-installer install codex
```

### Supported targets

```bash
patchright-agent-installer install codex      # -> ~/.agents/skills
patchright-agent-installer install claude     # -> ~/.claude/skills
patchright-agent-installer install --target <path>
```

### Advanced: Install from local repository

If you already have this repository cloned locally, run the installer from the repo root:

```bash
npx -y . install codex
```

See `installer/README.md` for full options (`--ref`, `--force`, `--dry-run`, etc.) and `docs/distribution.md` for publishing details.
