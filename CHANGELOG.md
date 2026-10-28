# Changelog

All notable changes to KyoRouter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-10-28

### 🎉 Initial Release

First public release of KyoRouter - forked from 9router with significant enhancements.

### Added
- **Persistent SQLite quota cache** - 7-day retention, survives server restarts
- **Smart auto-refresh** - Only refreshes providers accessed within 10 minutes
- **Batch UI updates** - Smooth rendering for 1000+ keys (50 keys per batch)
- **Dahl provider support** - Automatic limit inference from remaining tokens
- **Deep blue color palette** - Professional dark theme aesthetic
- **Comprehensive README** - Installation guide, features, roadmap

### Changed
- **Rebranded** from 9Router to KyoRouter
- **Updated color scheme** - Deep blue backgrounds (#0B0E13, #1A1D24)
- **Optimized quota tracking** - Conditional auto-fetch (skip providers with valid cache)
- **GitHub repository** - https://github.com/Ritski04/kyorouter

### Removed
- 9remote menu link (sidebar)
- 9english menu link (sidebar)
- Upstream telemetry references

### Fixed
- UI jitter when refreshing large key lists
- Quota percentage calculation for providers with incorrect limit values
- Unnecessary refetch on page navigation (now uses SQLite cache)
- Dahl provider "Quota not supported" error

---

## Forked from 9router

KyoRouter is based on [9router v0.5.111](https://github.com/decolua/9router) by decolua.

### What's Different?
- **Enhanced quota system** with persistent storage
- **Optimized performance** for large-scale key management
- **Cleaner UI** with modern dark theme
- **Better developer experience** with comprehensive documentation

---

## Roadmap

### v0.2.0 (Planned)
- [ ] Docker one-click deployment
- [ ] Webhook notifications (quota alerts)
- [ ] Provider health monitoring
- [ ] Backup/restore configuration
- [ ] Environment variable refactor for OAuth credentials

### v0.3.0 (Future)
- [ ] Multi-user support
- [ ] API rate limiting per user
- [ ] Advanced analytics dashboard
- [ ] Custom provider plugins
- [ ] Prometheus metrics export

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.
