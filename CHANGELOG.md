# Changelog

All notable changes to Standby are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Zero-config bundled trivia.** A question bank ships inside the extension, so
  Trivia works fully offline on first launch with no setup. A Supabase project is
  now an optional override for a larger/newer bank, with the bundled bank as the
  always-present fallback after network and cache.
- **Multi-window support.** With `standby.port: 0` (the new default) each window
  binds its own ephemeral port and registers in `~/.standby`; the hook routes each
  event to the window whose workspace contains its `cwd`, so several Cursor
  windows run Standby at once. Any non-zero `standby.port` keeps the legacy fixed
  bind.
- **Standby: Show Status / Diagnostics** command — a copy-pasteable report of the
  listener, installed hooks (with a per-event checklist), the registry, and the
  last event seen, plus one-click hook install/re-install when a mismatch is
  detected.
- One-time first-run notice pointing at the required secondary-sidebar placement.

### Fixed
- **Long-lived windows silently stopped receiving events.** A window's
  `~/.standby` entry was written once at activation and never refreshed, so after
  24 hours the registry TTL let the next window to start prune it as stale. The
  window kept listening, but the hook could no longer resolve its port and
  dropped every event — the panel stopped revealing, hiding, and pausing on
  `needsYou`. Each window now refreshes its entry every 10 minutes, which also
  re-creates it if another window's prune already dropped it.

### Changed
- The hook installer's confirmation now leads with the "restart Claude Code" step.
- README rewritten for a first-time installer, with a diagnostics-anchored
  troubleshooting section.

## [0.0.1]

Initial packaged build (v1).

### Added
- Reveal-on-working / instant-hide game panel that lives in the secondary sidebar
  (hide closes the auxiliary bar; the webview is retained so games resume in
  place).
- Three-state agent machine (`working` / `done` / `needsYou`) with a 300 ms Stop
  debounce and a 30-minute stuck-working watchdog.
- Games: Trivia, 2048, and Snake, with best scores persisted.
- Localhost hook transport: `hooks/standby-hook.sh` posts Claude Code hook events
  to the extension's listener; the installer merges the five hook entries into
  `~/.claude/settings.json` and never touches other hooks.
- Status bar reflecting the agent state at all times.
