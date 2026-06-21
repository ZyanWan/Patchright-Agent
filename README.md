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

## One-Line Installation

This repository is private. End users must have read access to `ZyanWan/Patchright-Agent` and be authenticated with GitHub CLI before installing.

```bash
npx -y git+https://github.com/ZyanWan/Patchright-Agent.git install codex
```

If using the future public npm installer package, users will run:

```bash
gh auth login
npx -y @zyanwan/patchright-agent-installer install codex
```

Supported targets in the first installer version:

```bash
npx -y git+https://github.com/ZyanWan/Patchright-Agent.git install codex
npx -y git+https://github.com/ZyanWan/Patchright-Agent.git install claude
npx -y git+https://github.com/ZyanWan/Patchright-Agent.git install --target ~/.agents/skills

npx -y @zyanwan/patchright-agent-installer install codex
npx -y @zyanwan/patchright-agent-installer install claude
npx -y @zyanwan/patchright-agent-installer install --target ~/.agents/skills
```

See `docs/distribution.md` and `installer/README.md` for publishing and installer details.
