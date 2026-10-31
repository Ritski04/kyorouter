# KyoRouter

> Self-hosted API Router with Smart Quota Management

KyoRouter is a self-hosted gateway that sits in front of your AI providers. It unifies multiple API keys under one OpenAI-compatible endpoint, tracks quota in real-time, and routes requests intelligently — so your tools never need to know which provider is behind the curtain.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

---

## ✨ Features

### Core Routing
- 🔀 **Multi-provider support** — OpenAI-compatible endpoint across any provider
- ⚖️ **Load balancing** — Spread requests across multiple keys automatically
- 🎯 **Smart routing** — Priority-based provider selection per combo
- 🔄 **Auto-retry** — Automatic failover when a provider errors

### Quota Management
- 📊 **Persistent tracking** — SQLite-backed quota cache that survives restarts
- 🎨 **Visual dashboard** — Progress bars, usage stats, token metrics per provider
- 🔔 **Smart refresh** — Only polls providers accessed in the last 10 minutes
- ⚡ **Batch operations** — Handles 1000+ keys without UI jitter

### Prompt Injection
- 💉 **Per-combo prompts** — Inject a system prompt on every request through a combo
- 🎯 **Per-model prompts** — Override at the model level (takes priority over combo)
- 🧩 **Additive layering** — Stacks on top of the global Token Saver prompt, never replacing it
- 📚 **Reusable templates** — Save prompts as templates and reuse them across combos/models

### Developer Experience
- 🖥️ **Web dashboard** — Dark-themed UI, works in any browser
- 🛠️ **Interactive CLI** — Terminal UI for managing tools, combos, and connections
- 📝 **Request logging** — Debug and monitor API calls in real-time
- 🔧 **CLI tool integration** — One command to point Claude Code, Codex, Cursor, and others at your gateway

---

## 🚀 Quick Start

> KyoRouter is **not on the public npm registry** — `npm install -g kyorouter` will not work. Install from GitHub.

### 1. Clone & Build

```bash
git clone https://github.com/Ritski04/kyorouter.git
cd kyorouter/cli
npm install
npm run build
```

### 2. Install

```bash
node cli.js install
```

This deploys the CLI to `%APPDATA%\kyorouter\cli` (Windows) or `~/.kyorouter/cli` (Linux/macOS) and writes the `kyorouter` command so it works from anywhere. The clone folder can be deleted afterwards.

### 3. Start the Gateway

```bash
kyorouter
```

Dashboard opens at `http://localhost:20128`. Change the port with `-p <port>`.

---

## 🔄 Updating

Once installed, update from anywhere — no clone needed:

```bash
kyorouter update
```

This pulls the latest source from GitHub, rebuilds the app + CLI under `%APPDATA%\kyorouter\update-src`, and deploys the fresh build to `%APPDATA%\kyorouter\cli`. Restart the gateway manually to apply the new build:

```bash
kyorouter --tray -p 20128
```

> Alternatively, run `update-global.bat` (Windows) or `update.sh` (Linux/macOS) from the repo for the same flow.

---

## 🔌 Connecting CLI Tools

Point your local AI coding tools at KyoRouter with one command:

```bash
kyorouter connect http://<your-server>:20128
```

Supported tools: **Claude Code**, **Codex**, **Cursor**, **Opencode**, **Droid**, **Crush**, **Kilo**, **Forge**, **Smelt**, and more.

```bash
# connect specific tools only
kyorouter connect http://localhost:20128 --tools claude,codex

# check current config for all tools
kyorouter show

# remove KyoRouter settings from tools
kyorouter connect --reset --tools claude,codex
```

Run `kyorouter connect --help` for the full list of options.

---

## 🛠️ Configuration

### Adding a Provider

Go to **Dashboard → Providers → Add Provider**:

- **Name** — a label for this provider
- **Base URL** — the OpenAI-compatible endpoint (e.g. `https://api.openai.com/v1`)
- **API Key** — your key for this provider
- **Priority** — lower = preferred when multiple providers are available

### Creating a Combo

A **combo** is a named route that groups providers. Your tools send requests to the combo name, and KyoRouter routes internally.

Go to **Dashboard → Combos → New Combo**, pick providers, set priority order, and save. Use the combo name as the model in any OpenAI-compatible request:

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KYOROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "my-combo", "messages": [{"role": "user", "content": "Hello"}]}'
```

### Prompt Injection

Inject system prompts at three levels — all additive, nothing overrides your global Token Saver:

| Level | Priority | Where to configure |
|-------|----------|--------------------|
| Per-model | Highest | Dashboard → Prompt Injection → Per Model tab |
| Per-combo | Fallback | Dashboard → Prompt Injection → Per Combo tab |
| Global (Token Saver) | Always applied | Dashboard → Settings |

**Per Combo tab:** pick a combo, write the prompt, toggle enabled.

**Per Model tab:** add models using the same picker as the Combo page. Prompts persist even when toggled off — remove a model entry with the ✕ button.

**Templates:** click **Templates** next to any editor to pick a built-in prompt or save your own as a reusable template.

---

## 📊 Dashboard Pages

| Page | What it shows |
|------|---------------|
| **Providers** | All configured providers, quota bars, refresh controls |
| **Combos** | Named routes, provider priority order, model aliases |
| **Custom Tokens** | Real-time quota per key, batch refresh, 5-min cache |
| **Prompt Injection** | Per-combo and per-model system prompt editor |
| **CLI Tools** | Connect/disconnect coding tools, view current config |
| **Logs** | Live request log with model, provider, token count |

---

## 🗂️ Project Structure

```
kyorouter/
├── cli/
│   ├── app/                # Next.js dashboard (built output)
│   ├── src/cli/
│   │   ├── commands/       # connect, show, update, install, xai
│   │   └── menus/          # Terminal UI menus
│   └── cli.js              # CLI entry point
├── src/
│   ├── app/                # Next.js app router (API routes + pages)
│   ├── shared/             # Shared components and constants
│   └── lib/                # Core libraries (db, auth, quota, etc.)
├── open-sse/               # Streaming proxy & provider executors
└── custom-server.js        # HTTP gateway entry point
```

---

## 🧑‍💻 Development

```bash
git clone https://github.com/Ritski04/kyorouter.git
cd kyorouter

# install all deps
npm install
cd cli && npm install && cd ..

# run dev server (dashboard + gateway)
npm run dev
```

Dashboard at `http://localhost:3000`, gateway at `http://localhost:20127` in dev mode.

To test CLI changes without reinstalling:

```bash
node cli/cli.js <command>
```

---

## 📋 Requirements

- Node.js >= 18
- npm
- ~200MB free disk space (for build output)

---

## 🙏 Acknowledgments

Forked from [9router](https://github.com/decolua/9router) by decolua.

KyoRouter adds:
- Persistent SQLite quota cache
- Smart auto-refresh (active providers only)
- Per-combo / per-model prompt injection with reusable templates
- `kyorouter update` and `kyorouter install` CLI commands
- Deep blue/purple dashboard aesthetic

---

## 📝 License

MIT — see [LICENSE](LICENSE).
