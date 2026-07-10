# Build Plan: While-You-Wait Panel ("Standby")

A Cursor/VS Code extension (TypeScript) that shows a small game panel while Claude Code works, and hides it the instant the agent finishes. Spec: see README / original SPEC.

## Ground truth gathered before planning

- **Repo**: empty except README — this is a greenfield build.
- **Trivia data** (`ball-knowledge` Supabase project, ref `zxfiteqxdnbwftqlduhv`):
  - `public.questions`: **341 rows, all `type = 'multiple_choice'`, all `verified = true`**. Columns: `id, prompt, options (jsonb), correct_index, sport, difficulty (1–5)`. So v1 trivia needs exactly one renderer: prompt + options + correct index. `fill_in_blank` / `matching` exist in the schema's check constraint but have zero rows — skip them.
  - **Blocker found**: RLS is enabled on `questions` with **no policies**, so the anon/publishable key can read nothing today. Milestone 4 must add a read-only policy before the extension can fetch questions.
- **Claude Code hook events** map cleanly onto the three states:
  | Hook | State |
  |---|---|
  | `UserPromptSubmit` | working |
  | `Stop` | done |
  | `Notification` (permission request or waiting-for-input) | needs you |
  | `PostToolUse` | working (clears "needs you" once an approval is granted and the tool runs) |
  | `SessionEnd` | done (prevents a stuck panel when the session exits) |

  Hooks receive JSON on stdin (`session_id`, `cwd`, `hook_event_name`, and `message` for Notification), which gives us workspace matching for free.

## Architecture (one page)

```
Claude Code (in Cursor terminal)
   │  hooks (settings.json) run a tiny shipped script: standby-hook
   │  reads stdin JSON → POST http://127.0.0.1:<port>/event
   ▼
Extension host (Node)
   ├─ HttpListener      localhost-only server, validates payload, filters by cwd
   ├─ AgentStateMachine working | done | needsYou (+ timestamps, debounce)
   ├─ PanelController   reveals/hides the webview view on state transitions
   ├─ HookInstaller     command that merges hook entries into ~/.claude/settings.json
   └─ TriviaStore       fetches + caches questions (globalState), serves them to the webview
   ▼ postMessage
Webview (single bundle, no framework)
   ├─ state indicator (working / done / needs you)
   ├─ game switcher: Trivia | 2048 | Snake
   └─ needs-you view: shows the Notification message + "Go to terminal" button
```

Design decisions locked in up front:

- **Panel placement**: a `WebviewView` in a dedicated container in the **secondary sidebar (auxiliary bar)** — it never covers code and never competes with the terminal panel where the agent lives. Show = reveal view; hide = `workbench.action.closeAuxiliaryBar`. Owning our own container keeps collateral damage near zero. After revealing, immediately return focus with `workbench.action.focusActiveEditorGroup` so keyboard focus is never stolen; the user clicks in when they want to play.
- **Port strategy (v1)**: fixed default port (e.g. `48219`, configurable). The hook script posts `{event, cwd, message}`; the extension ignores events whose `cwd` isn't inside one of its workspace folders. Multi-window Cursor is explicitly deferred (see Risks).
- **Hook transport**: ship `hooks/standby-hook.sh` (POSIX shell, uses `curl`, reads stdin) inside the extension. The installer writes absolute paths into `~/.claude/settings.json`. No node process spin-up per event — hooks must be fast.
- **Trivia access**: plain `fetch` against PostgREST (`GET /rest/v1/questions?select=…&verified=eq.true`) with the publishable key — no `supabase-js` dependency. Key + URL live in extension settings (`standby.supabase.url`, `standby.supabase.key`); publishable keys are designed to be client-side, and RLS limits exposure to read-only questions.
- **Games**: vendor small MIT implementations adapted to the webview (candidate: `gabrielecirulli/2048`, MIT). Snake is small enough (~150 lines canvas) that adapting an existing snippet vs. writing it is a wash. All theming via `--vscode-*` CSS variables so dark/light mode is free.
- **No framework in the webview**: vanilla TS + esbuild, one bundle. Keeps it small and instant.

## Milestones

Each milestone ends in something runnable. Order is chosen so the risky/novel part (agent-state lifecycle) is proven before any game work.

### M0 — Scaffold (small)
- `yo code`-style skeleton by hand: `package.json` (contributes: view container in auxiliary bar, webview view, commands, configuration), `tsconfig`, esbuild for both extension and webview bundles, `.vscodeignore`.
- Commands stubbed: `standby.installHooks`, `standby.showPanel`, `standby.hidePanel`.
- **Done when**: extension loads in the Extension Development Host (F5 in Cursor), empty webview view renders themed background.

### M1 — State engine + hooks (the heart; do this before any UI)
- `HttpListener`: `http.createServer` bound to `127.0.0.1` only; single `POST /event` route; rejects non-local, malformed, and wrong-cwd payloads; port from settings.
- `AgentStateMachine`: `working | done | needsYou`, with the `PostToolUse → working` clear and `SessionEnd → done`. Debounce rule: a `Stop` followed within ~300ms by nothing stays `done`; rapid `Stop → UserPromptSubmit` (user immediately re-prompts) must not flash the panel.
- `hooks/standby-hook.sh` + `HookInstaller` command: idempotent merge of the five hook entries into `~/.claude/settings.json` (never clobber existing hooks; back the file up first). Also print the JSON for manual install.
- Status bar item as the first consumer: `⋯ working / ✓ done / ● needs you` — this makes the lifecycle testable with zero UI work.
- `scripts/fake-agent.sh`: curls the event sequence with sleeps to simulate a session; used for all later testing.
- **Done when**: with hooks installed, running a real Claude Code prompt in the Cursor terminal flips the status bar working → done, and a permission prompt flips it to needs-you and back.

### M2 — Panel shell + auto show/hide
- `PanelController`: on `working` → reveal view (focus restored to editor); on `done` → hide **immediately** (the hide path is the feel-critical one: no animation-before-hide, no debounce on hide); on `needsYou` → swap webview content to the approval surface.
- Webview shell: header with state dot + game tabs, content area, message protocol (`postMessage` both ways), CSP locked down, all assets local.
- Respect the user: if the user manually closes the panel during a wait, don't re-reveal until the next `working` transition.
- **Done when**: `fake-agent.sh` makes the panel appear/disappear correctly, editor focus never moves, and closing it by hand sticks for that run.

### M3 — Games: 2048 + Snake (no credentials needed, so they come before trivia)
- Vendor/adapt 2048 (MIT) into the webview bundle; restyle with theme variables.
- Snake on `<canvas>`, arrow keys + WASD, theme-colored.
- Game switcher tabs; per-game state survives tab switches within a wait; scores kept in `webview` state (persist best scores in `globalState` — cheap and pleasant).
- Pause/blur handling: when the panel hides mid-game, freeze the game so returning later isn't a death screen.
- **Done when**: both games are playable during a fake wait, look native in dark and light themes.

### M4 — Trivia (Supabase)
- **Migration on `ball-knowledge` first** (this is currently a hard blocker):
  ```sql
  create policy "anon read verified questions"
    on public.questions for select to anon
    using (verified = true);
  ```
- `TriviaStore` in the extension host: fetch all 341 questions once (they're tiny), cache in `globalState` with a TTL (e.g. 24h), shuffle queue, serve one at a time to the webview. Offline/failed fetch → fall back to cache; no cache → hide the Trivia tab rather than erroring.
- Multiple-choice renderer: prompt, 4 options, instant right/wrong feedback, sport + difficulty badge, next question. Track streak in-session.
- Settings for URL/key with a README section on where to find them; never log the key.
- **Done when**: trivia plays through real `ball-knowledge` questions with the publishable key and works offline after first fetch.

### M5 — Needs-you surface
- When state = `needsYou`: replace the game with the Notification `message` text, large and calm, plus a "Go to terminal" button (`workbench.action.terminal.focus`). Optional subtle status-bar pulse — no sounds, no toasts.
- `PostToolUse` (approval granted) returns to the game exactly where it was paused.
- **Done when**: a real permission prompt in Claude Code surfaces in the panel within ~1s, and answering it resumes the game.

### M6 — Feel pass (budget real time for this; the spec says it's what makes or breaks it)
- Hide latency: measure `Stop` → panel gone; target < 100ms perceived. Appear can be soft (short fade); disappear must be instant.
- Flicker audit with rapid fake-agent sequences (stop/start within 1s, double notifications, out-of-order events).
- Stuck-state guard: if `working` for > 30 min with no events (crashed session, killed terminal), decay to `done` and hide.
- Idle-third-day annoyances: no badge counts, no "you have a new question!" nudges, panel never appears when the editor window isn't focused… whatever shakes out of a few days of real dogfooding. Keep a running `FEEL.md` of irritations and fix them here.
- **Done when**: after 2–3 days of daily use, nothing about it is annoying enough to note.

### M7 — Package & install
- `vsce package` → `.vsix`; install into Cursor via "Install from VSIX"; verify hooks + port work outside the dev host.
- README: install steps, hook install (automatic command + manual JSON), settings reference, uninstall (including hook removal — `standby.uninstallHooks`).
- License (MIT), attribution for vendored 2048.
- **Done when**: clean-machine-style install from the `.vsix` alone works end to end.

## Risks & deliberate deferrals

- **Multi-window Cursor**: two windows → second listener fails to bind. V1: second instance shows a one-time warning and stays dormant. Future design (documented, not built): per-window ephemeral ports + a `~/.standby/ports.json` registry the hook script consults by `cwd`.
- **Hook fragility**: if the extension isn't running, hook `curl`s fail — must fail *silently and fast* (`curl --max-time 0.3 … || true`) so Claude Code is never slowed or noisy. This constraint goes in the hook script from day one.
- **Cursor vs VS Code API drift**: we use only bread-and-butter APIs (WebviewView, status bar, commands, configuration) — low risk, but M0 runs in Cursor itself, not stock VS Code, from the first F5.
- **`Stop` fires per reply, not per task**: with multi-turn agent loops this is exactly what we want (each reply-finish means "you can act"), but dogfooding in M6 will confirm the debounce feels right.
- **Publishable key in settings.json**: acceptable for a single-user local tool with read-only RLS; revisit only if this ever ships to a marketplace.

## Suggested repo layout

```
src/extension.ts        activation, wiring
src/listener.ts         localhost HTTP server
src/state.ts            AgentStateMachine
src/panel.ts            PanelController + WebviewViewProvider
src/hooks.ts            HookInstaller / uninstaller
src/trivia.ts           TriviaStore (fetch + cache)
webview/                index.ts, ui.css, games/{g2048,snake,trivia}/
hooks/standby-hook.sh   shipped hook script
scripts/fake-agent.sh   lifecycle simulator
```

## Order of work, restated as a checklist

- [x] M0 scaffold boots in Cursor
- [x] M1 hooks → listener → state machine → status bar, verified against real Claude Code
- [x] M2 panel auto show/hide with correct focus behavior
- [ ] M3 2048 + Snake playable and themed
- [ ] M4 RLS policy migration + trivia end to end
- [ ] M5 needs-you surface with jump-to-terminal
- [ ] M6 feel pass after multi-day dogfooding
- [ ] M7 .vsix packaging, docs, hook uninstall
