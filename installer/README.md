# Patchright Agent Installer

Public command-line installer for the private `ZyanWan/Patchright-Agent` Skill repository.

The package is intentionally thin. It contains no private Skill files; it only downloads the private source repository with GitHub CLI and installs all valid directories under `skills/` into the selected Agent skills directory.

## Usage

```bash
npx -y @zyanwan/patchright-agent-installer install codex
npx -y @zyanwan/patchright-agent-installer install claude
npx -y @zyanwan/patchright-agent-installer install --target ~/.agents/skills
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
