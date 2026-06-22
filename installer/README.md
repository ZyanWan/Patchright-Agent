# Patchright Agent Installer

Command-line installer for the Patchright-Agent Skill package.

The current team installation path uses the public npm package with bundled skills. Use the fixed `0.2.0` command and keep the explicit `--source patchright-agent-installer/skills` value so installation reads from the bundled skills directory and does not clone GitHub.

## Usage

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install codex --source patchright-agent-installer/skills
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install claude --source patchright-agent-installer/skills
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install --target ~/.agents/skills --source patchright-agent-installer/skills
```

To update an existing installation, add `--force`:

```bash
npx --registry=https://registry.npmjs.org/ --prefer-online -y @zyanwan/patchright-agent-installer@0.2.0 install codex --source patchright-agent-installer/skills --force
```

## Options

```text
--scope user|project       Default: user
--target <path>            Install into an explicit skills directory
--repo <owner/repo>        Default: ZyanWan/Patchright-Agent
--ref <branch-or-tag>      Checkout a specific ref after cloning
--source <path>            Skills source directory. For npm 0.2.0 use: patchright-agent-installer/skills
--force                    Back up and replace existing installed skills
--dry-run                  Print planned actions without cloning or copying
--keep-temp                Keep the temporary clone for debugging
```

## Publish

```bash
npm publish --access public
```

If `@zyanwan` is not available on npm, change the package name in `package.json` and update the installation command.
