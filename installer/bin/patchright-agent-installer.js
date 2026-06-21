#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_REPO = "ZyanWan/Patchright-Agent";
const DEFAULT_SOURCE = "skills";

const TARGETS = {
  codex: {
    user: path.join(os.homedir(), ".agents", "skills"),
    project: path.resolve(".agents", "skills")
  },
  claude: {
    user: path.join(os.homedir(), ".claude", "skills"),
    project: path.resolve(".claude", "skills")
  }
};

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.command === "help" || parsed.options.help) {
    printHelp();
    return;
  }

  if (parsed.command === "doctor") {
    await doctor();
    return;
  }

  if (parsed.command !== "install") {
    throw new Error(`Unknown command "${parsed.command}". Run with "help" for usage.`);
  }

  await install(parsed);
}

function parseArgs(argv) {
  const command = argv[0] || "help";
  const options = {
    repo: DEFAULT_REPO,
    source: DEFAULT_SOURCE,
    scope: "user",
    target: null,
    ref: null,
    force: false,
    dryRun: false,
    keepTemp: false,
    help: false
  };
  const positionals = [];

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--repo") {
      options.repo = readValue(argv, ++index, arg);
    } else if (arg === "--source") {
      options.source = readValue(argv, ++index, arg);
    } else if (arg === "--scope") {
      options.scope = readValue(argv, ++index, arg);
    } else if (arg === "--target") {
      options.target = readValue(argv, ++index, arg);
    } else if (arg === "--ref") {
      options.ref = readValue(argv, ++index, arg);
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--keep-temp") {
      options.keepTemp = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option "${arg}".`);
    } else {
      positionals.push(arg);
    }
  }

  if (!["user", "project"].includes(options.scope)) {
    throw new Error(`Invalid --scope "${options.scope}". Use "user" or "project".`);
  }

  return {
    command,
    agent: positionals[0] || null,
    options
  };
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

async function install({ agent, options }) {
  const targetRoot = resolveTargetRoot(agent, options);
  const plan = {
    repository: options.repo,
    ref: options.ref || "default branch",
    source: options.source,
    target: targetRoot,
    scope: options.target ? "custom" : options.scope,
    agent: options.target ? "custom" : agent
  };

  printPlan(plan);

  if (options.dryRun) {
    console.log("\nDry run complete. No files were changed.");
    return;
  }

  ensureCommand("gh", "Install GitHub CLI and run: gh auth login");
  ensureCommand("git", "Install Git so GitHub CLI can clone repositories.");
  ensureGitHubAuth();

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "patchright-agent-"));
  let cleanupTemp = true;

  try {
    run("gh", ["repo", "clone", options.repo, tempRoot], {
      hint: `Could not clone ${options.repo}. Confirm the user has repository access and has run "gh auth login".`
    });

    if (options.ref) {
      run("git", ["-C", tempRoot, "checkout", options.ref], {
        hint: `Could not checkout ref "${options.ref}".`
      });
    }

    const sourceRoot = path.resolve(tempRoot, options.source);
    const skills = await findSkillDirectories(sourceRoot);

    if (skills.length === 0) {
      throw new Error(`No skill directories with SKILL.md were found under ${sourceRoot}.`);
    }

    await preflightExisting(targetRoot, skills, options.force);
    await mkdir(targetRoot, { recursive: true });

    for (const skill of skills) {
      const destination = path.join(targetRoot, skill.name);

      if (await exists(destination)) {
        const backup = await nextBackupPath(destination);
        await rename(destination, backup);
        console.log(`Backed up existing ${skill.name} -> ${backup}`);
      }

      await cp(skill.path, destination, {
        recursive: true,
        force: false,
        errorOnExist: true
      });
      console.log(`Installed ${skill.name} -> ${destination}`);
    }

    console.log("\nInstall complete.");
    cleanupTemp = !options.keepTemp;
    if (options.keepTemp) {
      console.log(`Temporary clone kept at ${tempRoot}`);
    }
  } finally {
    if (cleanupTemp) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

function resolveTargetRoot(agent, options) {
  if (options.target) {
    return path.resolve(expandHome(options.target));
  }

  if (!agent) {
    throw new Error("Missing target agent. Use: install codex, install claude, or install --target <path>.");
  }

  const target = TARGETS[agent];
  if (!target) {
    throw new Error(`Unsupported agent "${agent}". Supported agents: ${Object.keys(TARGETS).join(", ")}.`);
  }

  return target[options.scope];
}

function expandHome(input) {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith(`~${path.sep}`) || input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

async function findSkillDirectories(sourceRoot) {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(sourceRoot, entry.name);
    if (await exists(path.join(skillPath, "SKILL.md"))) {
      skills.push({ name: entry.name, path: skillPath });
    }
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function preflightExisting(targetRoot, skills, force) {
  const existing = [];

  for (const skill of skills) {
    const destination = path.join(targetRoot, skill.name);
    if (await exists(destination)) {
      existing.push(destination);
    }
  }

  if (existing.length > 0 && !force) {
    throw new Error(
      [
        "The following skills are already installed:",
        ...existing.map((item) => `  - ${item}`),
        "Re-run with --force to back them up and install the new copy."
      ].join("\n")
    );
  }
}

async function nextBackupPath(destination) {
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replaceAll(".", "")
    .replace("T", "-")
    .replace("Z", "");
  let backup = `${destination}.backup-${stamp}`;
  let suffix = 1;

  while (await exists(backup)) {
    backup = `${destination}.backup-${stamp}-${suffix}`;
    suffix += 1;
  }

  return backup;
}

async function exists(targetPath) {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureCommand(command, hint) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.error || result.status !== 0) {
    throw new Error(`${command} is required. ${hint}`);
  }
}

function ensureGitHubAuth() {
  const result = spawnSync("gh", ["auth", "status"], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    throw new Error("GitHub CLI is not authenticated. Run: gh auth login");
  }
}

function run(command, args, { hint }) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.error || result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error([hint, output].filter(Boolean).join("\n"));
  }
}

async function doctor() {
  console.log("Patchright Agent Installer doctor\n");

  reportCommand("git", "Git");
  reportCommand("gh", "GitHub CLI");

  const ghStatus = spawnSync("gh", ["auth", "status"], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (ghStatus.status === 0) {
    console.log("ok   GitHub CLI is authenticated");
  } else {
    console.log("fail GitHub CLI is not authenticated");
    console.log("     Run: gh auth login");
  }

  console.log("\nDefault targets:");
  for (const [name, scopes] of Object.entries(TARGETS)) {
    console.log(`- ${name} user:    ${scopes.user}`);
    console.log(`- ${name} project: ${scopes.project}`);
  }
}

function reportCommand(command, label) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status === 0) {
    const version = result.stdout.trim().split(/\r?\n/)[0];
    console.log(`ok   ${label}: ${version}`);
  } else {
    console.log(`fail ${label} is not available`);
  }
}

function printPlan(plan) {
  console.log("Patchright Agent Skill install plan\n");
  console.log(`Repository: ${plan.repository}`);
  console.log(`Ref:        ${plan.ref}`);
  console.log(`Source:     ${plan.source}`);
  console.log(`Agent:      ${plan.agent}`);
  console.log(`Scope:      ${plan.scope}`);
  console.log(`Target:     ${plan.target}`);
}

function printHelp() {
  console.log(`Patchright Agent Installer

Usage:
  patchright-agent-installer install codex [options]
  patchright-agent-installer install claude [options]
  patchright-agent-installer install --target <path> [options]
  patchright-agent-installer doctor

Options:
  --scope user|project       Default: user
  --target <path>            Install into an explicit skills directory
  --repo <owner/repo>        Default: ${DEFAULT_REPO}
  --ref <branch-or-tag>      Checkout a specific ref after cloning
  --source <path>            Skills source directory inside the repo, default: ${DEFAULT_SOURCE}
  --force                    Back up and replace existing installed skills
  --dry-run                  Print planned actions without cloning or copying
  --keep-temp                Keep the temporary clone for debugging
  -h, --help                 Show this help

Examples:
  npx -y @zyanwan/patchright-agent-installer install codex
  npx -y @zyanwan/patchright-agent-installer install claude --force
  npx -y @zyanwan/patchright-agent-installer install --target ~/.agents/skills
`);
}
