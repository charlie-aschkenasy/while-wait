# Standby ("while-wait") — What's Been Built

A Cursor / VS Code extension (TypeScript) that shows a small **game panel while
Claude Code is working** in your terminal, and hides it the instant the agent
finishes or needs your attention. It exists to make the "waiting for the agent"
gaps pleasant instead of idle — without ever getting in the way of your code,
your terminal, or your keyboard focus.

Status: **all milestones M0–M7 complete.** Packaged as `standby-0.0.1.vsix`.

---

## 1. What it does, from the user's seat

You install the extension, run one command to wire up Claude Code hooks, and
dock a small "Standby" panel in Cursor's secondary (right) sidebar. From then on:

- **Claude starts working** → the panel appears (a soft 150 ms fade). Focus is
  *not* stolen — the cursor stays in your editor/terminal; you click into the
  panel only when you actually want to play.
- **You play** one of three games — **Trivia, 2048, or Snake** — via tabs at the
  top of the panel.
- **Claude finishes** → the panel vanishes immediately (no animation on the way
  out — the disappearance is the feel-critical path). Your game is *paused in
  place*, not destroyed.
- **Claude needs you** (a permission prompt or a "waiting for your input"
  notification) → the panel swaps the game for a calm **"Claude needs you"**
  surface showing the notification text and a **"Go to terminal"** button.
  Approving the request in the terminal returns you to your game exactly where
  it was.
- A **status-bar item** mirrors the agent state at all times:
  `⋯ working` / `✓ done` / `● needs you` (the last one highlighted).

No sounds, no toasts, no badge counts, no "you have a new question!" nudges. The
design goal from the spec was that after several days of daily use, *nothing
about it is annoying enough to note*.

---

## 2. The three agent states

Everything is driven by a three-state model derived from Claude Code hook events:

| State | Meaning | What the panel does |
|---|---|---|
| `working` | Agent is running | Reveal the panel (unless you closed it by hand this run, or the window is unfocused) |
| `done` | Agent finished / session ended | Hide the panel immediately |
| `needsYou` | Permission request or input needed | Reveal + show the "needs you" surface |

### Hook → state mapping

| Claude Code hook | Resulting state |
|---|---|
| `UserPromptSubmit` | `working` |
| `PostToolUse` | `working` (also clears `needsYou` once an approval is granted and the tool runs) |
| `Notification` | `needsYou` (carries the notification `message`) |
| `Stop` | `done` (after a 300 ms settle — see below) |
| `SessionEnd` | `done` immediately (never leave a stuck panel) |

### Timing rules baked into the state machine

- **Stop debounce (300 ms):** a `Stop` only becomes `done` if nothing follows
  within ~300 ms. A rapid `Stop → UserPromptSubmit` (you immediately re-prompt)
  therefore never flashes the panel off and back on.
- **Stuck-working watchdog (30 min):** if the state is `working` with no events
  for 30 minutes (crashed session, killed terminal), it decays to `done` so the
  panel can never get stuck open.

---

## 3. The games

All three are original, framework-free implementations that theme themselves
entirely from `--vscode-*` CSS variables, so they look native in dark and light
themes. Each conforms to a small `GameInstance` contract (`activate` /
`deactivate` / `handleKey` / `setBest`) so the shell can pause any game on hide
and resume it on reveal — **never killing the player** with a death screen for
walking away.

- **Trivia** — multiple-choice sports questions. Ships with a **bundled offline
  bank** (`data/trivia/questions.json`) so it works zero-config on first launch
  with no network; an optional Supabase project can supply a larger/newer bank.
  Shows the prompt, four options, instant right/wrong feedback, sport + difficulty
  badges, and tracks an in-session **streak** (best streak persisted). Pulls
  questions one at a time from the extension host.
- **2048** — the classic 4×4 slide-and-merge puzzle (original implementation,
  inspired by Gabriele Cirulli's game). Arrow keys; best score persisted.
- **Snake** — a 16×16 `<canvas>` grid, arrow keys **and** WASD, with a
  pause/resume overlay; best score persisted.

Best scores live in the extension's `globalState` (persist across sessions) and
are echoed back into the webview on load. The active game tab is remembered via
the webview's own `getState`/`setState`.

---

## 4. Architecture

```
Claude Code (in the Cursor terminal)
   │  hooks in ~/.claude/settings.json run a tiny shipped shell script
   │  standby-hook.sh: reads the hook's stdin JSON, POSTs it to localhost
   ▼
Extension host (Node)
   ├─ HttpListener       127.0.0.1-only server; single POST /event route
   ├─ AgentStateMachine  working | done | needsYou (+ debounce & watchdog)
   ├─ PanelController     reveals / hides the webview view on state changes
   ├─ StandbyViewProvider the WebviewView itself (kept alive while hidden)
   ├─ HookInstaller       installs/uninstalls the five hook entries
   └─ TriviaStore         bundled bank + optional Supabase, serves one at a time
   ▼ postMessage (both ways)
Webview (single esbuild bundle, no framework)
   ├─ header: state dot + game tabs
   ├─ game area: Trivia | 2048 | Snake
   └─ needs-you surface: notification text + "Go to terminal"
```

### Component detail

- **`src/listener.ts` — HttpListener.** `http.createServer` bound to `127.0.0.1`
  only. One route: `POST /event`. Rejects non-local method/URL (404), oversized
  bodies (64 KB cap), malformed JSON (400), and payloads whose `hook_event_name`
  isn't one of the five or whose `cwd` is missing (400). Responds `204`
  *before* processing so the hook's `curl` returns instantly. If the port is
  already bound (another Cursor window), it shows a one-time warning and stays
  dormant.

- **`src/state.ts` — AgentStateMachine.** Pure state logic with the debounce and
  watchdog timers described above. Emits a typed `StateChange` event that both
  the status bar and the panel subscribe to.

- **`src/panel.ts` — StandbyViewProvider + PanelController.**
  - The `WebviewView` is registered with **`retainContextWhenHidden: true`**, so
    the webview process (and all game state) stays alive while hidden.
  - **Reveal** (`working`, or `needsYou`): if the view is already resolved, just
    re-show the retained webview — instant, with games intact. On the very first
    reveal of a session it forces the view to resolve and then hands focus
    straight back to the editor so focus is never stolen.
  - **Hide** (`done`): closes the auxiliary (secondary) sidebar container. The
    webview is *not* destroyed, so the next reveal is instant.
  - **Respect the user:** if you close the panel by hand mid-wait, it stays
    closed until the next `working` transition. If a wait starts while the Cursor
    window is unfocused, the reveal is deferred until you refocus (if the wait is
    still on).
  - Owns the two-way `postMessage` protocol with the webview (state updates,
    scores, trivia questions in; ready / score / trivia-next / focus-terminal
    out).

- **`src/hooks.ts` — HookInstaller / uninstaller.** `installHooks` merges the
  five hook entries into `~/.claude/settings.json` **idempotently**: it backs the
  file up first, refreshes its own entries in place on re-install (path/port
  changes), and never touches hooks it didn't add (entries are identified by a
  `standby-hook.sh` marker). `PostToolUse` gets a `"*"` matcher; the others are
  matcher-less. Offers a "Show hook JSON" action for manual installation and
  degrades gracefully if the settings file is invalid JSON. `uninstallHooks`
  removes exactly the marked entries and prunes empty groups.

- **`src/trivia.ts` — TriviaStore.** Serves questions from a reshuffled queue,
  validating each row's shape. Source precedence: a fresh `globalState` cache
  (24 h TTL) → a live Supabase PostgREST fetch
  (`GET /rest/v1/questions?select=…&verified=eq.true`, publishable key, no
  `supabase-js` dependency) → a stale cache → the **bundled bank** shipped in the
  `.vsix` (`data/trivia/questions.json`, read via `asAbsolutePath`). The bundled
  bank is the always-present floor: with no Supabase settings it's the zero-config
  default, and with Supabase configured it's the final fallback after network and
  cache. Trivia only reports unavailable — hiding the Trivia tab — if that bundled
  load itself fails (missing/corrupt file), a rare safety edge rather than the
  normal unconfigured outcome. **Never logs the key.**

- **`webview/index.ts` — the shell.** Vanilla TS. Builds the header/tabs/content,
  instantiates games lazily and keeps them in a `Map` (so switching tabs
  preserves each game's state), routes keyboard input to the active game, and
  pauses **all** games on `window.blur` / `visibilitychange` (hidden). Renders the
  needs-you surface when the state is `needsYou`, freezing the game underneath.
  CSP is locked to a per-load nonce and local resources only.

- **`hooks/standby-hook.sh` — the transport.** POSIX shell, no Node spin-up per
  event. Reads the hook's stdin JSON and `curl -s --max-time 0.3`s it to
  `http://127.0.0.1:<port>/event`, swallowing all errors (`|| true`). If the
  extension isn't running, it fails **silently in under 300 ms** so Claude Code
  is never slowed or made noisy — in any project, whether or not Cursor is open.

---

## 5. Configuration

### Settings

| Setting | Default | Purpose |
|---|---|---|
| `standby.port` | `0` | `0` = auto: per-window ephemeral port + `~/.standby` registry the hook routes by `cwd` (multi-window safe). Any non-zero value forces a fixed bind; re-run the hook installer after changing it. |
| `standby.supabase.url` | — | Supabase project URL for trivia |
| `standby.supabase.key` | — | Supabase **publishable** key for trivia (client-safe; RLS limits it to reading verified questions) |

### Commands (command palette)

| Command | Purpose |
|---|---|
| Standby: Show Panel | Reveal the panel manually |
| Standby: Hide Panel | Hide the panel manually |
| Standby: Install Claude Code Hooks | Merge hook entries into `~/.claude/settings.json` |
| Standby: Uninstall Claude Code Hooks | Remove Standby's hook entries (others untouched) |

### Trivia data (bundled bank + optional Supabase)

The bundled bank (`data/trivia/questions.json`) ships in the `.vsix` and plays
offline with no configuration — it seeds from the same 341 verified questions and
fills toward a larger target over time (see PLAN-V2 §1a). Each row is
`{ id, prompt, options[4], correct_index, sport, difficulty }` with optional
`source_url`/`verified_on` provenance; `scripts/validate-trivia.mjs` gates it.

Optionally, a Supabase project (`ball-knowledge`) supplies a larger/newer bank: a
read-only RLS policy exposes only `verified = true` rows to the anon/publishable
key, and the live results are cached for 24 h. On any fetch failure the extension
falls through to the stale cache and then the bundled bank, so trivia never goes
unavailable when configured.

---

## 6. Feel guarantees (the part the spec said makes or breaks it)

- Appear is a soft ~150 ms fade; **disappear is instant** (no animation, no
  debounce on hide).
- Focus is never stolen — the panel reveals with focus handed back to the editor.
- The panel never appears while the Cursor window is unfocused; it catches up
  when you return if the wait is still on.
- Closing the panel by hand sticks for the rest of that run.
- Games pause on hide and **resume in place** on the next reveal (the webview is
  kept alive rather than rebuilt).
- No sounds, no toasts, no badges, no nudges.

---

## 7. Known limitations & deliberate deferrals

- **Multi-window:** with `standby.port` at its default (`0` = auto), each window
  binds an **ephemeral** port and registers `{pid, port, folders, updated}` in
  `~/.standby/ports.json`, plus a flat `~/.standby/ports.tsv` (one
  `<folder>\t<port>` line per folder) that the POSIX hook greps by `cwd` — so two
  Cursor windows each drive only their own panel. Folders are stored resolved to
  their physical path (symlinks followed), and the hook resolves its cwd the same
  way (`pwd -P`). The registry self-heals: dead-pid and stale (>24 h) entries are
  pruned on every write and on startup. Setting `standby.port` to any **non-zero**
  value forces the legacy single fixed-port bind (that window still registers, so
  the hook converges on the same port); a second window on the same fixed port
  shows the one-time dormant warning as before.
- **Secondary-sidebar dependency:** hide works by closing the auxiliary
  (secondary) sidebar, so the panel must live there and be the only thing there —
  other views docked in that sidebar would be hidden alongside it.
- **Publishable key in settings.json:** acceptable for a single-user local tool
  with read-only RLS; would be revisited before any marketplace release.
- **`Stop` fires per reply, not per task:** intended — each reply-finish means
  "you can act" — with the 300 ms debounce smoothing rapid re-prompts.

---

## 8. Tech stack & build

- **Language:** TypeScript. **VS Code API:** `^1.85`. **No UI framework**;
  vanilla TS + a single esbuild bundle for the webview and one for the extension.
- **No runtime dependencies of note** — trivia uses `fetch` against PostgREST
  directly rather than `supabase-js`.
- **Build:** `npm run watch` (esbuild, rebuild on change) for development;
  `npm run package` runs `@vscode/vsce package` → `standby-0.0.1.vsix`.
  `tsc --noEmit` for type-checking (`noUnusedLocals` / `noUnusedParameters` on).
- **Dev loop:** F5 launches an Extension Development Host opening
  `test-workspace/`. `scripts/fake-agent.sh` and `scripts/stress-agent.sh`
  simulate agent lifecycles (including needs-you, and flicker/robustness audits)
  without a real Claude Code session.

---

## 9. Repository layout

```
src/extension.ts         activation & wiring
src/listener.ts          localhost HTTP server
src/state.ts             AgentStateMachine
src/panel.ts             PanelController + WebviewViewProvider
src/hooks.ts             hook installer / uninstaller
src/trivia.ts            TriviaStore (bundled bank + optional Supabase)
webview/index.ts         webview shell & message protocol
webview/ui.css           theming via --vscode-* variables
webview/games/           g2048.ts, snake.ts, trivia.ts, types.ts
hooks/standby-hook.sh    shipped hook transport
scripts/fake-agent.sh    lifecycle simulator
scripts/stress-agent.sh  flicker / robustness simulator
media/icon.svg           activity-bar icon
PLAN.md                  full build plan & milestone checklist
FEEL.md                  dogfooding irritation log
README.md                install / setup / usage
```

---

## 10. Milestone status

- **M0** Scaffold boots in Cursor — done
- **M1** Hooks → listener → state machine → status bar — done
- **M2** Panel auto show/hide with correct focus behavior — done
- **M3** 2048 + Snake, playable and themed — done
- **M4** Supabase RLS policy + trivia end to end — done
- **M5** Needs-you surface with jump-to-terminal — done
- **M6** Feel pass (dogfooding) — done
- **M7** `.vsix` packaging, docs, hook uninstall — done
