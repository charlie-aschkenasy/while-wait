# Standby ("while-wait")

A Cursor/VS Code panel that shows a small game — **Trivia, 2048, Snake** — while
Claude Code is working in your terminal, and vanishes the instant the agent
finishes or needs you. No sounds, no toasts, no badges; keyboard focus is never
stolen.

![Standby docked in the secondary sidebar, reacting to a working agent](https://raw.githubusercontent.com/charlie-aschkenasy/while-wait/main/media/screenshot.png)

## Get started (5 steps)

Standby needs a one-time layout step and a hook install. Follow these in order —
the whole path takes a couple of minutes.

1. **Install the extension.** Download the latest `.vsix` from the
   [GitHub releases page](https://github.com/charlie-aschkenasy/while-wait/releases)
   (this is the canonical install). In Cursor: command palette
   (`Cmd/Ctrl+Shift+P`) → **Extensions: Install from VSIX…** → pick the file.

   Once the Open VSX listing is live it will be the second option (Cursor pulls
   from Open VSX, not the VS Code Marketplace) — *link pending the first
   published release*.

   To build from source instead (developer path):
   ```sh
   npm install
   npm run package        # → standby-<version>.vsix
   ```
2. **Reload the window** when prompted (or run **Developer: Reload Window**).
3. **Place the panel in the secondary sidebar** (this is what makes hide work).
   Click the Standby icon in the activity bar, then drag the **Standby** view
   into the **secondary sidebar** (the right-hand sidebar). Keep that sidebar for
   Standby *alone* — hide works by closing the secondary sidebar, so any other
   view docked there gets hidden too. (See the screenshot above.)
4. **Install the hooks.** Run **Standby: Install Claude Code Hooks** from the
   command palette. It backs up `~/.claude/settings.json` and merges five hook
   entries that tell Standby when Claude starts and stops working.
5. **Restart any running Claude Code session** so it picks up the new hooks.

Now start Claude Code working in your terminal: the panel appears while it works
and disappears the moment it's done. When Claude needs a permission or your
input, the panel swaps to a calm "Claude needs you" surface with a
jump-to-terminal button. The status bar shows the state at all times:
`⋯ working / ✓ done / ● needs you`.

Trivia works **offline out of the box** — a question bank ships with the
extension, no setup required. (Optionally bring your own larger bank; see below.)

## Troubleshooting

**Nothing happens when Claude works?** Run **Standby: Show Status / Diagnostics**
from the command palette. It opens a copy-pasteable report — paste it into an
issue if you're stuck. It tells you, at a glance:

- whether the **hooks are installed** (a per-event checklist) and whether their
  path matches this build — if not, it offers **Re-install hooks** (do that, then
  restart Claude Code);
- the **listener** state and port (and, if a window is "dormant", that another
  window holds a fixed port);
- the **last event** the extension received vs. accepted — if events arrive but
  are rejected, the Claude Code session's working directory is outside this
  window's workspace, so it's ignored on purpose;
- the multi-window **registry** contents.

Common cases:

- **Panel never appears** → hooks not installed, or you didn't restart Claude
  Code after installing them. Run diagnostics; use its install/re-install action.
- **Second window does nothing** → only relevant if you set a fixed
  `standby.port`; two windows can't share one fixed port. Leave `standby.port` at
  `0` (auto) and each window gets its own.
- **Changed `standby.port` and it broke** → the installed hook still points at
  the old port; diagnostics detects this and offers **Re-install hooks**.

## Optional: bring your own trivia bank

The bundled bank is the default. To use a larger/newer bank from a Supabase
project, add to your **user** settings:

```json
{
  "standby.supabase.url": "https://<project-ref>.supabase.co",
  "standby.supabase.key": "sb_publishable_..."
}
```

Both values are in the Supabase dashboard under **Project Settings → API**: the
Project URL and the **publishable** key (client-safe; row-level security limits
it to reading verified questions). Never use the secret / service-role key. On
any fetch failure Standby falls back to its cache and then the bundled bank, so
trivia never goes dark.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `standby.port` | `0` | `0` = auto (recommended): each window binds its own ephemeral port and registers in `~/.standby`, so multiple windows work at once. Any non-zero value forces a fixed port — re-run the hook installer after changing it. |
| `standby.supabase.url` | — | *Optional.* Supabase project URL for a larger trivia bank. |
| `standby.supabase.key` | — | *Optional.* Supabase **publishable** key (never the secret key). |

## Commands

| Command | Purpose |
|---|---|
| Standby: Show Status / Diagnostics | Open a copy-pasteable status report (start here if something's off) |
| Standby: Install Claude Code Hooks | Merge hook entries into `~/.claude/settings.json` |
| Standby: Uninstall Claude Code Hooks | Remove Standby's hook entries (others untouched) |
| Standby: Show Panel | Reveal the panel manually |
| Standby: Hide Panel | Hide the panel manually |

## Behavior notes

- The panel only reacts to events whose `cwd` is inside the current window's
  workspace, so unrelated Claude Code sessions don't trigger it.
- If the window is unfocused when a wait starts, the panel waits until you come
  back — it never pops up in the background or steals focus.
- Closing the panel by hand mid-wait keeps it closed until the next run.
- The webview is kept alive while hidden, so games pause on hide and resume
  instantly and in place on the next reveal (no reload).
- A `working` state with no events for 30 minutes decays to `done` (crashed
  session guard).
- The hook fails silently in <300 ms when no window is listening, so Claude Code
  is never slowed down — in any project, with or without Cursor open.
- **Multi-window**: with `standby.port: 0` (the default) each Cursor window binds
  its own ephemeral port and the hook routes each event to the window whose
  workspace contains its `cwd`, so several windows run Standby at once.

## Uninstall

1. Run **Standby: Uninstall Claude Code Hooks** (removes the
   `~/.claude/settings.json` entries; a backup is written next to it).
2. Uninstall the extension from the Extensions view.

## Development

```sh
npm install
npm run watch    # rebuild on change
```

F5 launches an Extension Development Host opening `test-workspace/`. Simulate
agent lifecycles without a real session:

```sh
scripts/fake-agent.sh "$PWD/test-workspace"     # normal session incl. needs-you
scripts/stress-agent.sh "$PWD/test-workspace"   # flicker/robustness audit
```

In multi-window (auto) mode these resolve the target window's port from
`~/.standby/ports.tsv` by the cwd you pass. `FEEL.md` tracks dogfooding
irritations; `PLAN.md` and `PLAN-V2.md` have the full build plan.

Release notes live in [`CHANGELOG.md`](CHANGELOG.md); third-party and derived
content is credited in [`THIRD-PARTY.md`](THIRD-PARTY.md).

## License

MIT. The 2048 and Snake implementations are original to this repo (2048 is
inspired by Gabriele Cirulli's game). See [`THIRD-PARTY.md`](THIRD-PARTY.md).
