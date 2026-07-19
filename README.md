# Standby ("while-wait")

A Cursor/VS Code extension that shows a small game panel — **Trivia, 2048,
Snake** — while Claude Code works in your terminal, and hides it the instant
the agent finishes or needs you.

- Panel appears when Claude starts working, vanishes immediately on completion.
- Keyboard focus is never stolen; click into the panel when you want to play.
- When Claude needs a permission or your input, the panel swaps to a calm
  "Claude needs you" surface with a jump-to-terminal button.
- Status bar shows the agent state at all times: `⋯ working / ✓ done / ● needs you`.

## Install

1. Build the `.vsix` (or grab one from a release):
   ```sh
   npm install
   npm run package        # → standby-0.0.1.vsix
   ```
2. In Cursor: command palette → **Extensions: Install from VSIX…** → pick the file.
3. Reload the window when prompted.
4. One-time layout step: click the Standby icon in the activity bar, then drag
   the **Standby** view into the **secondary sidebar** (right side) so it never
   competes with your editor or terminal. Cursor remembers this.

## Hook setup (required)

Standby learns what Claude Code is doing via [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks).
Run **Standby: Install Claude Code Hooks** from the command palette. This:

- backs up `~/.claude/settings.json`, then
- merges five hook entries (`UserPromptSubmit`, `Stop`, `Notification`,
  `PostToolUse`, `SessionEnd`) that POST to `http://127.0.0.1:48219/event`
  via the bundled `hooks/standby-hook.sh`.

Existing hooks are never touched, and re-running the command is safe (it
updates the entries in place). "Show hook JSON" displays the entries for
manual installation instead. **Restart any running Claude Code session** to
pick up the hooks.

The hook script fails silently in <300ms when the extension isn't running, so
Claude Code is never slowed down — in any project, with or without Cursor open.

## Trivia setup (optional)

Trivia questions come from a Supabase project. Add to your **user** settings:

```json
{
  "standby.supabase.url": "https://<project-ref>.supabase.co",
  "standby.supabase.key": "sb_publishable_..."
}
```

Both values are in the Supabase dashboard under **Project Settings → API**:
the Project URL and the **publishable** key (client-safe; row-level security
limits it to reading verified questions). Never use the secret / service-role
key. Questions are cached for 24 h, so trivia works offline after the first
fetch. Without configuration or cache, the Trivia tab hides itself.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `standby.port` | `48219` | Localhost port the extension listens on (must match the installed hooks — re-run the hook installer after changing it) |
| `standby.supabase.url` | — | Supabase project URL for trivia |
| `standby.supabase.key` | — | Supabase publishable key for trivia |

## Commands

| Command | Purpose |
|---|---|
| Standby: Show Panel | Reveal the panel manually |
| Standby: Hide Panel | Hide the panel manually |
| Standby: Install Claude Code Hooks | Merge hook entries into `~/.claude/settings.json` |
| Standby: Uninstall Claude Code Hooks | Remove Standby's hook entries (others untouched) |

## Behavior notes

- The panel only reacts to events whose `cwd` is inside the current window's
  workspace, so unrelated Claude Code sessions don't trigger it.
- If the window is unfocused when a wait starts, the panel waits until you
  come back.
- Closing the panel by hand mid-wait keeps it closed until the next run.
- A `working` state with no events for 30 minutes decays to `done` (crashed
  session guard).
- **Multi-window limitation (v1)**: only the first Cursor window binds the
  port; other windows show a one-time warning and stay dormant.

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

`FEEL.md` tracks dogfooding irritations; `PLAN.md` has the full build plan.

## License

MIT. The 2048 and Snake implementations are original to this repo (2048 is
inspired by Gabriele Cirulli's game).
