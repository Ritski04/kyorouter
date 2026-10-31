#!/usr/bin/env node
// `kyorouter update` — pull the latest from GitHub, rebuild, and reinstall the
// global package. Run from anywhere: it clones into the app-data dir so it
// never touches a local dev folder.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = "https://github.com/Ritski04/kyorouter.git";
const BRANCH = "main";
const APP_NAME = "kyorouter";

function appDataDir() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || "", "kyorouter")
    : path.join(os.homedir(), ".kyorouter");
}

function step(msg) {
  console.log(`\n\x1b[36m==\x1b[0m ${msg}`);
}

function run(cmd, args, opts = {}) {
  // On Windows npm is npm.cmd and spawnSync can't exec it without a shell
  // (ESWIN/ENOENT + "spawnSync npm.cmd EINVAL"). Resolve to npm.cmd and run
  // it through the shell, quoting args so paths with spaces survive.
  const isWin = process.platform === "win32";
  const resolved = isWin && cmd === "npm" ? "npm.cmd" : cmd;
  const res = spawnSync(resolved, args, {
    stdio: "inherit",
    shell: isWin,
    ...opts,
  });
  if (res.status !== 0) {
    console.error(`\n❌ Command failed: ${cmd} ${args.join(" ")}`);
    process.exit(res.status || 1);
  }
}

let workDir = path.join(appDataDir(), "update-src");

function ensureDeps() {
  // Fresh clone has no node_modules (repo does not track deps). Install
  // root + cli deps before building. Reuses cache, so repeats are quick.
  // Always run npm install (not only when node_modules is missing): after a
  // `git reset --hard` the lockfile may list deps not yet present locally.
  step("Installing root dependencies");
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: workDir });
  step("Installing CLI dependencies");
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: path.join(workDir, "cli") });
}

function run(args) {
  // args unused by update currently — kept for signature parity.
  try {
    if (!fs.existsSync(workDir)) {
      step("Cloning kyorouter from GitHub");
      run("git", ["clone", "--depth", "1", "--branch", BRANCH, REPO, workDir]);
    } else {
      step("Pulling latest from GitHub");
      run("git", ["-C", workDir, "fetch", "origin", BRANCH]);
      run("git", ["-C", workDir, "reset", "--hard", `origin/${BRANCH}`]);
    }

    ensureDeps();

    step("Building the app + CLI (this takes a minute)");
    run("npm", ["run", "build"], { cwd: workDir });
    run("npm", ["run", "build"], { cwd: path.join(workDir, "cli") });

    step("Reinstalling global package (breaks npm hardlink, fetch is fine)");
    run("npm", ["uninstall", "-g", APP_NAME], { stdio: "ignore" });
    run("npm", ["install", "-g", "."], { cwd: path.join(workDir, "cli") });

    console.log(`
\x1b[32m==========================================\x1b[0m
  Update complete!
  - Latest from GitHub: ${REPO}
  - Global package reinstalled (free-standing copy)
  - Restart the gateway to use the new build: kill it and run "kyorouter --tray"
\x1b[32m==========================================\x1b[0m`);
    return 0;
  } catch (e) {
    console.error(`\n❌ Update failed: ${e?.message || e}`);
    return 1;
  }
}

module.exports = { run };
