#!/usr/bin/env node
// `kyorouter update` — pull the latest from GitHub, rebuild, and reinstall the
// global package. Run from anywhere: it clones into the app-data dir so it
// never touches a local dev folder.
const { spawnSync, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = "https://github.com/Ritski04/kyorouter.git";
const BRANCH = "main";

function appDataDir() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || "", "kyorouter")
    : path.join(os.homedir(), ".kyorouter");
}

function step(msg) {
  console.log(`\n\x1b[36m==\x1b[0m ${msg}`);
}

// Stop any process listening on `port` (best effort, Windows + POSIX).
function killPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr ":${port}" | findstr LISTENING`, { encoding: "utf8", windowsHide: true });
      const pids = new Set();
      for (const line of out.split("\n")) {
        const m = line.trim().match(/\s+(\d+)\s*$/);
        if (m) pids.add(m[1]);
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true }); console.log(`   Stopped gateway (PID ${pid})`); }
        catch { }
      }
    } else {
      execSync(`fuser -k ${port}/tcp 2>/dev/null || true`);
      console.log(`   Stopped gateway on port ${port}`);
    }
  } catch { /* no listener — fine */ }
}

function exec(cmd, args, opts = {}) {
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
// Directory of THIS CLI package (where update.js lives), i.e. the clone's cli/
// (e.g. C:\Users\kikir\kyorouter\cli) — vs a dev project checkout.
const cliDir = path.resolve(__dirname, "..", "..", "..");

function ensureDeps() {
  // Fresh clone has no node_modules (repo does not track deps). Install
  // root + cli deps before building. Reuses cache, so repeats are quick.
  // Always run npm install (not only when node_modules is missing): after a
  // `git reset --hard` the lockfile may list deps not yet present locally.
  step("Installing root dependencies");
  exec("npm", ["install", "--no-audit", "--no-fund"], { cwd: workDir });
  step("Installing CLI dependencies");
  exec("npm", ["install", "--no-audit", "--no-fund"], { cwd: path.join(workDir, "cli") });
}

function run(args) {
  // args unused by update currently — kept for signature parity.
  try {
    if (!fs.existsSync(workDir)) {
      step("Cloning kyorouter from GitHub");
      exec("git", ["clone", "--depth", "1", "--branch", BRANCH, REPO, workDir]);
    } else {
      step("Pulling latest from GitHub");
      exec("git", ["-C", workDir, "fetch", "origin", BRANCH]);
      exec("git", ["-C", workDir, "reset", "--hard", `origin/${BRANCH}`]);
    }

    ensureDeps();

    step("Building the app + CLI (this takes a minute)");
    exec("npm", ["run", "build"], { cwd: workDir });
    exec("npm", ["run", "build"], { cwd: path.join(workDir, "cli") });

    step("Stopping running gateway (port 20128) before deploying...");
    killPort(20128);

    step("Deploying build to the running installation (clone dir)");
    // e.g. C:\Users\kikir\kyorouter\cli. Replace its app/ build with the freshly
    // built one so a gateway restart picks up the new code. cli/app is a build
    // artifact, so this never destroys source.
    const runningCliDir = path.dirname(process.argv[1] || __filename);
    const targetApp = path.join(runningCliDir, "app");
    const builtApp = path.join(workDir, "cli", "app");
    if (fs.existsSync(targetApp)) {
      console.log(`   Replacing ${targetApp}`);
      fs.rmSync(targetApp, { recursive: true, force: true });
      fs.cpSync(builtApp, targetApp, { recursive: true });
      console.log(`   Deployed app → ${targetApp}`);
    } else {
      console.log(`   ⚠️  No existing app at ${targetApp} — skipped deploy`);
    }

    console.log(`
\x1b[32m==========================================\x1b[0m
  Update complete!
  - Latest from GitHub: ${REPO}
  - App deployed to the running installation
  - Restart the gateway to use the new build: run "kyorouter --tray -p 20128"
\x1b[32m==========================================\x1b[0m`);
    return 0;
  } catch (e) {
    console.error(`\n❌ Update failed: ${e?.message || e}`);
    return 1;
  }
}

module.exports = { run };
