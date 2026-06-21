# Patchright Agent Installer

Command-line installer for the private `ZyanWan/Patchright-Agent` Skill repository.

When run from the private GitHub repository with `npx git+https://...`, it installs bundled `skills/` directly. When installed as a public npm package without bundled skills, it downloads the private source repository with GitHub CLI and installs all valid directories under `skills/` into the selected Agent skills directory.

## Usage

```bash
npx -y git+https://github.com/ZyanWan/Patchright-Agent.git install codex
npx -y git+https://github.com/ZyanWan/Patchright-Agent.git install claude
npx -y git+https://github.com/ZyanWan/Patchright-Agent.git install --target ~/.agents/skills

npm install -g @zyanwan/patchright-agent-installer --registry=https://registry.npmjs.org/
patchright-agent-installer install codex
patchright-agent-installer install claude
patchright-agent-installer install --target ~/.agents/skills
```

Private repository access is handled by GitHub CLI:

```bash
gh auth login
```

## Options

```text
--scope user|project       Default: user
--target <path>            Install into an explicit skills directory
--repo <owner/repo>        Default: ZyanWan/Patchright-Agent
--ref <branch-or-tag>      Checkout a specific ref after cloning
--source <path>            Skills source directory inside the repo, default: skills
--force                    Back up and replace existing installed skills
--dry-run                  Print planned actions without cloning or copying
--keep-temp                Keep the temporary clone for debugging
```

## Publish

```bash
npm publish --access public
```

If `@zyanwan` is not available on npm, change the package name in `package.json` and update the installation command.
