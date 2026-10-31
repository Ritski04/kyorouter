#!/usr/bin/env node
// `kyorouter install` — bootstrap install that keeps everything under APP_DATA:
// clones/builds into a temp dir, deploys the CLI to %APPDATA%\\kyorouter\\cli, and
// writes the `kyorouter` shims into the npm bin dir so the command works from
// anywhere. Run once from a fresh clone: `node cli.js install`.
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

function exec(cmd, args, opts = {}) {
  const isWin = process.platform === "win32";
  const resolved = isWin && cmd === "npm" ? "npm.cmd" : cmd;
  const res = spawnSync(resolved, args, { stdio: "inherit", shell: isWin, ...opts });
  if (res.status !== 0) {
    console.error(`\n❌ Command failed: ${cmd} ${args.join(" ")}`);
    process.exit(res.status || 1);
  }
}

// Where the `kyorouter` executable shims live (npm bin dir).
function getBinDir() {
  if (process.platform === "win32") {
    const out = execSync('npm prefix -g', { encoding: "utf8", windowsHide: true }).trim();
    return out ? path.join(out, "") : path.join(process.env.APPDATA || "", "npm");
  }
  const out = execSync('npm prefix -g', { encoding: "utf8" }).trim();
  return out;
}

function writeShims(cliJsPath) {
  const binDir = getBinDir();
  const rel = cliJsPath;

  // .cmd
  const cmd = `@ECHO off\r\nSET "KYO_CLI=${rel}"\r\nIF EXIST "%KYO_CLI%" (\r\n  node "%KYO_CLI%" %*\r\n) ELSE (\r\n  ECHO [kyorouter] cli.js not found at %KYO_CLI%\r\n  EXIT /b 1\r\n)\r\n`;
  fs.writeFileSync(path.join(binDir, "kyorouter.cmd"), cmd);

  // .ps1
  const ps1 = `#!/usr/bin/env pwsh\r\n$exe=""\r\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) { $exe=".exe" }\r\n$ret=0\r\nif ($MyInvocation.ExpectingInput) {\r\n  $input | & "node$exe"  "${rel}" $args\r\n} else {\r\n  & "node$exe"  "${rel}" $args\r\n}\r\n$ret=$LASTEXITCODE\r\nexit $ret\r\n`;
  fs.writeFileSync(path.join(binDir, "kyorouter.ps1"), ps1);

  // bash shim: convert backslashes to forward slashes for the exec target.
  const fwd = rel.replace(/\\/g, "/");
  const sh = `#!/bin/sh\nexec node "${fwd}" "$@"\n`;
  fs.writeFileSync(path.join(binDir, "kyorouter"), sh);

  console.log(`   Shims written → ${binDir}\\kyorouter{.cmd,.ps1,sh}`);
}

function run(args) {
  try {
    // 1. Clone (if not already) into a scratch dir under APP_DATA
    const scratch = path.join(appDataDir(), "_install-src");
    if (!fs.existsSync(scratch)) {
      step("Cloning kyorouter from GitHub");
      exec("git", ["clone", "--depth", "1", "--branch", BRANCH, REPO, scratch]);
    } else {
      step("Refreshing clone");
      exec("git", ["-C", scratch, "fetch", "origin", BRANCH]);
      exec("git", ["-C", scratch, "reset", "--hard", `origin/${BRANCH}`]);
    }

    // 2. Install deps + build
    step("Installing root dependencies");
    exec("npm", ["install", "--no-audit", "--no-fund"], { cwd: scratch });
    step("Installing CLI dependencies");
    exec("npm", ["install", "--no-audit", "--no-fund"], { cwd: path.join(scratch, "cli") });
    step("Building the app + CLI (this takes a minute)");
    exec("npm", ["run", "build"], { cwd: scratch });
    exec("npm", ["run", "build"], { cwd: path.join(scratch, "cli") });

    // 3. Deploy to APP_DATA\\kyorouter\\cli
    const targetCli = path.join(appDataDir(), "cli");
    const builtApp = path.join(scratch, "cli");
    step("Deploying to the installation dir");
    if (fs.existsSync(targetCli)) {
      console.log(`   Replacing ${targetCli}`);
      fs.rmSync(targetCli, { recursive: true, force: true });
    }
    fs.cpSync(builtApp, targetCli, { recursive: true });
    console.log(`   Deployed → ${targetCli}`);

    // 4. Write shims
    const cliJsPath = path.join(targetCli, "cli.js");
    step("Writing kyorouter command shims");
    writeShims(cliJsPath);

    console.log(`
\x1b[32m==========================================\x1b[0m
  Install complete!
  - CLI installed to: ${targetCli}
  - Command: kyorouter (from anywhere)
  - Start the gateway: kyorouter --tray -p 20128
\x1b[32m==========================================\x1b[0m`);
    return 0;
  } catch (e) {
    console.error(`\n❌ Install failed: ${e?.message || e}`);
    return 1;
  }
}

module.exports = { run };
