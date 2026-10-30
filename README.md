# KyoRouter

> Self-hosted API Router with Smart Quota Management

KyoRouter is a high-performance API routing solution optimized for developers managing multiple AI providers. Built for flexibility and control with persistent quota tracking, intelligent request routing, and zero vendor lock-in.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

---

## ✨ Features

### Core Routing
- 🔀 **Multi-provider support** — OpenAI-compatible APIs with automatic fallback
- ⚖️ **Load balancing** — Distribute requests across multiple keys
- 🎯 **Smart routing** — Priority-based provider selection
- 🔄 **Auto-retry** — Automatic failover on errors

### Quota Management
- 📊 **Persistent tracking** — SQLite-backed quota cache (survives restarts)
- 🎨 **Visual dashboard** — Progress bars, usage stats, token metrics
- 🔔 **Smart refresh** — Auto-update only recently accessed providers
- 📈 **Usage analytics** — Daily/historical token consumption

### Performance
- ⚡ **Batch operations** — Efficient updates for 1000+ keys
- 💾 **Intelligent caching** — 60s in-memory + 7-day SQLite persistence
- 🚀 **Sequential probing** — 50ms delay prevents rate limits
- 🎯 **Optimized UI** — Smooth rendering with batched state updates

### Developer Experience
- 🖥️ **Web dashboard** — Modern dark-themed UI
- 🛠️ **CLI tools** — Command-line management
- 📝 **Request logging** — Debug and monitor API calls
- 🔧 **Flexible config** — JSON-based provider setup

### Prompt Injection
- 💉 **Per-combo prompts** — Inject a system prompt on every request routed through a combo
- 🎯 **Per-model prompts** — Set prompts directly on individual models (wins over combo prompts)
- 🧩 **Additive layering** — Model/combo prompts stack on top of the global Token Saver prompt
- 📚 **Reusable templates** — Save custom prompt templates and reuse them across combos/models

---

## 🚀 Quick Start

### Installation

```bash
npm install -g kyorouter
```

### Start Server

```bash
kyorouter
```

The dashboard will open at `http://localhost:20128`

### Basic Usage

1. **Add Provider** — Configure your AI provider credentials
2. **Create Endpoint** — Generate your unified API endpoint
3. **Start Routing** — Use the endpoint in your applications

```bash
# Example: Use KyoRouter as OpenAI proxy
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KYOROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## 📦 Installation Options

### NPM (Recommended)

```bash
npm install -g kyorouter
kyorouter
```

### From Source

```bash
git clone https://github.com/Ritski04/kyorouter.git
cd kyorouter/cli
npm install
npm run build
npm start
```

### Requirements

- Node.js >= 18.0.0
- npm or yarn
- 200MB free disk space

---

## 🎯 Use Cases

### Multi-Provider Management
Manage dozens of API keys across multiple providers with unified quota tracking and automatic load balancing.

### Cost Optimization
Track token usage in real-time, identify expensive requests, and optimize spending across providers.

### Development & Testing
Test applications against multiple AI providers without changing code. Switch providers with configuration changes only.

### High Availability
Automatic failover ensures your application keeps running even when individual providers experience downtime.

---

## 🛠️ Configuration

### Provider Setup

Navigate to **Dashboard → Providers** and add your API credentials:

```json
{
  "name": "OpenAI Primary",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "priority": 1
}
```

### Quota Tracking

KyoRouter automatically tracks quota for supported providers:

- **Supported:** OpenAI, Anthropic, Gemini, Dahl, and more
- **Storage:** SQLite database with 7-day retention
- **Auto-refresh:** Smart polling (only active providers)

---

## 📊 Dashboard Overview

### Custom Tokens Page
- Real-time quota visualization
- Progress bars with color coding (green/yellow/red)
- Batch refresh for efficient updates
- Persistent cache across sessions

### Usage Analytics
- Daily/monthly token consumption
- Cost estimation (when available)
- Provider comparison charts
- Request logs with filtering

---

## 🔧 Advanced Features

### Smart Auto-Refresh
Only refreshes providers accessed within the last 10 minutes — saves resources and respects rate limits.

### Batch State Updates
Handles 1000+ keys smoothly by batching UI updates (50 keys per batch) — no more UI jitter.

### Dahl Provider Support
Automatic limit inference for providers that only return remaining tokens.

### SQLite Persistence
Quota data survives server restarts. 7-day automatic cleanup keeps database lean.

### Prompt Injection (per Combo / per Model)

Inject custom system prompts at three levels, all additive — nothing replaces your global Token Saver skill prompt:

1. **Per-model prompt** — most specific; applies when a request routes to that model.
2. **Per-combo prompt** — fallback for combo members that have no prompt of their own.
3. **Global Token Saver prompt** — always applies, stacked underneath the above.

**Priority:** `per-model` → `per-combo` → `global`.

- Configure in **Dashboard → Prompt Injection** (sidebar menu).
- **Per Combo** tab: pick a combo, write its prompt, toggle enabled. Override any member’s prompt individually.
- **Per Model** tab: add models from the same selector used on the Combo page, then set/disable each prompt. Models persist even when disabled; remove them with the ✕ button.
- **Templates**: click **Templates** beside any prompt editor — pick a built-in prompt or save your current text as a reusable custom template. Your templates persist and appear under *Your templates*.

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting PRs.

### Development Setup

```bash
git clone https://github.com/Ritski04/kyorouter.git
cd kyorouter/cli
npm install
npm run dev
```

### Project Structure

```
kyorouter/
├── cli/                    # CLI package
│   ├── app/               # Next.js dashboard
│   └── src/               # CLI source code
├── src/
│   ├── app/               # Next.js app router
│   ├── shared/            # Shared components
│   └── lib/               # Core libraries
└── custom-server.js       # HTTP proxy server
```

---

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Forked from [9router](https://github.com/decolua/9router) by decolua.

KyoRouter adds:
- Persistent SQLite quota cache
- Smart auto-refresh system
- Enhanced UI with batch updates
- Dahl provider integration
- Deep blue aesthetic redesign
- Per-combo / per-model prompt injection with reusable templates

---

## 📧 Support

- **Issues:** [GitHub Issues](https://github.com/Ritski04/kyorouter/issues)
- **Discussions:** [GitHub Discussions](https://github.com/Ritski04/kyorouter/discussions)

---

## 🗺️ Roadmap

### Version 0.2.0 (Coming Soon)
- [ ] Docker one-click deployment
- [ ] Webhook notifications (quota alerts)
- [ ] Provider health monitoring
- [ ] Backup/restore configuration

### Version 0.3.0
- [ ] Multi-user support
- [ ] API rate limiting
- [ ] Advanced analytics dashboard
- [ ] Custom provider plugins

---

**Built with ❤️ for developers who need control over their AI infrastructure.**
