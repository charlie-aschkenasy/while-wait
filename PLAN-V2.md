# Standby v2 — Plan (public release + feature build-out)

Standby is a Cursor/VS Code extension that reveals a small game panel while Claude
Code is working and hides it the instant the agent finishes or needs you. v1
(milestones M0–M7 in `PLAN.md` / `OVERVIEW.md`) is complete and packaged as
`standby-0.0.1.vsix`, but it is not yet safe to hand to a stranger: trivia
depends on the author's private Supabase project, only one Cursor window can bind
the listener, and the install flow assumes prior context. **v2 hardens Standby for
open-source distribution first, ships it, then grows it** — zero-config bundled
trivia and multi-window support (Phase 1), distribution prep for Open VSX + a
GitHub release (Phase 2), a local wait-time stats surface as the launch feature
(Phase 3), a configurable apps strip (Phase 4), and four new games (Phase 5). Every
phase ships as a working increment; a later phase never starts until the earlier
one builds clean (`npm run build` + `npm run typecheck`), packages, and passes its
verification steps. The v1 architecture (three-state machine, localhost listener,
retained webview, hook transport) and the section-6 feel guarantees are held fixed
throughout; wherever a new feature pushes on them, that pressure is called out
explicitly.

## Phase-ordered overview

| Phase | Title | Why it's here / gate |
|---|---|---|
| **1** | Harden for strangers | **Blocking.** Nothing ships until trivia is zero-config, two windows both work, and a cold install succeeds from one tweet's worth of instructions. |
| **2** | Distribution prep | Publisher metadata, license/changelog/icon, Open VSX + GitHub-release packaging, one-step release CI. Prepared, not published; the human runs the final manual steps. |
| **3** | Wait-time stats | The launch feature. Local-only session tracking + a screenshot-clean daily card. |
| **4** | Apps strip | Slim configurable quick-jump buttons via `openExternal`. |
| **5** | New games | Chess tactics → Minesweeper → Klondike → Sudoku, in that order, each conforming to the `GameInstance` contract. |

Feel guarantees that bind **every** phase (OVERVIEW.md §6): appear is a soft ~150 ms
fade, **disappear is instant**; focus is never stolen; the panel never appears while
the window is unfocused; a hand-close sticks for the run; games pause on hide and
resume in place; **no sounds, no toasts, no badges, no nudges**. Every item judged by
feel (a card "looking screenshot-worthy", a game "feeling right") is **built and handed
to the human** — never self-declared done. Handoffs are marked `⟶ HANDOFF` below.

---

## Phase 1 — Harden for strangers (blocking)

### 1a. Zero-config bundled trivia (2000 questions), Supabase optional

**Goal.** A stranger who installs the `.vsix` and never touches settings gets a full
trivia game that works entirely offline. Supabase stays as an optional override for
the author (and for anyone who wants a bigger/newer bank).

#### Milestones / done-when
- `data/trivia/questions.json` ships inside the `.vsix` with **2000 verified
  questions** and validates against the existing `isValidQuestion` shape.
- With **no** `standby.supabase.*` settings, the Trivia tab plays through the bundled
  bank offline, first launch, no network.
- With Supabase configured, the extension uses Supabase as before and **falls back to
  the bundled bank** (not just to a stale cache) on any fetch failure.
- `npm run build && npm run typecheck` clean; `.vsix` size increase within the agreed
  budget (see Open Decisions).

#### JSON schema and file location
- **Location:** `data/trivia/questions.json` (a new top-level `data/` dir). It is not
  matched by `.vscodeignore`, so it ships by default; add `!data/**` intent by leaving
  `data/` out of the ignore file and verifying with `vsce ls` (verification step below).
  Loaded **extension-side** (Node/CJS `dist/extension.js`) via
  `context.asAbsolutePath('data/trivia/questions.json')` + `fs.readFileSync` — the same
  path-resolution pattern `src/hooks.ts` already uses for `hooks/standby-hook.sh`. It is
  **not** placed under `dist/webview/`, so no CSP/`localResourceRoots` change is needed:
  questions continue to reach the webview one at a time via the existing `postMessage`
  `trivia` channel.
- **Schema** (field parity with the Supabase rows so one validator covers both, plus
  provenance for authored questions):
  ```
  {
    "id":            string,      // stable slug, e.g. "bkb-0412"
    "prompt":        string,
    "options":       string[4],   // exactly 4, per the ground-truth bank
    "correct_index": 0..3,
    "sport":         "Fighting|Soccer|Hockey|Basketball|Golf|Baseball|Football",
    "difficulty":    1..5,
    "source_url":    string,      // authored questions only: the verification source
    "verified_on":   "YYYY-MM-DD" // authored questions only: when it was checked
  }
  ```
  `source_url` / `verified_on` are optional and ignored by `isValidQuestion`; they exist
  so the fact-check trail lives with the data. The top-level file may be either a bare
  array or `{ "version": n, "questions": [...] }` — **recommend the wrapped form** so a
  future schema bump is detectable.

#### Exporting the existing 341 (Supabase project ref `zxfiteqxdnbwftqlduhv`, `public.questions`)
Reuse the exact PostgREST shape the extension already speaks (`src/trivia.ts`):
`GET {url}/rest/v1/questions?select=id,prompt,options,correct_index,sport,difficulty&verified=eq.true`
with the publishable key in the `apikey` header, piped to a file. Equivalent one-shot
options: a `curl` of that URL, or `supabase db dump`/`psql \copy (select … ) to stdout
with (format json)`. **Recommend the PostgREST curl** — it returns exactly the shipping
shape, needs only the publishable key, and matches what the extension validates. Save as
the seed of `questions.json`, then run it through the same dedupe/verify pipeline (below)
as a consistency check (the 341 are already verified; this only normalizes IDs and catches
any time-varying strays like the flagged "most career goals → Ovechkin").

#### Scaling to 2000 — target counts (mirror the existing distributions)
2000 total − 341 existing = **1659 new**. Targets computed by scaling the current
proportions (×2000/341 for sport; by difficulty share for difficulty), then rounding to
sum exactly.

**Per sport** (existing → final target → new needed):

| Sport | Existing | Final | New |
|---|---|---|---|
| Fighting | 50 | 293 | 243 |
| Soccer | 50 | 293 | 243 |
| Hockey | 49 | 287 | 238 |
| Basketball | 49 | 287 | 238 |
| Golf | 48 | 282 | 234 |
| Baseball | 48 | 282 | 234 |
| Football | 47 | 276 | 229 |
| **Total** | **341** | **2000** | **1659** |

**Per difficulty** (existing → final target → new needed):

| Difficulty | Existing | Share | Final | New |
|---|---|---|---|---|
| 1 | 78 | 23% | 458 | 380 |
| 2 | 104 | 30% | 610 | 506 |
| 3 | 109 | 32% | 639 | 530 |
| 4 | 35 | 10% | 205 | 170 |
| 5 | 15 | 4% | 88 | 73 |
| **Total** | **341** | | **2000** | **1659** |

**Calibration note:** apply the difficulty mix *within each sport* rather than uniformly,
nudging each sport's mean toward its current average (Soccer 2.10 … Golf 2.85) so per-sport
feel is preserved. The 35 sport×difficulty cells become the generation worklist; each cell
carries a target count derived from the joint proportion. This keeps both marginals on
target without flattening the per-sport character.

#### Generation + fact-checking pipeline (a repeatable process — do NOT run it now)
Structure it as a batched, resumable sub-project with an auditable trail. Recommended shape:
1. **Worklist.** A CSV/JSONL of the 35 cells with target counts and a running `remaining`
   column, so batches are resumable and progress is visible.
2. **Generate a batch** (e.g. 20–30 candidates for one cell). Constrain the generator to
   **settled history** — completed careers, finals results, retired records, rule facts,
   founding dates — and **forbid time-varying answers**: current rosters, "active leader",
   standing records that are still being chased, "most X ever" for a live stat (the
   Ovechkin trap). Prefer questions whose answer was true 5 years ago and will be true in 5
   years.
3. **Verify every candidate** with a web search before inclusion. Record the `source_url`
   and `verified_on`. A candidate that cannot be corroborated by a reputable source is
   **discarded**, not softened. A candidate whose correct answer could change with a future
   season is discarded even if currently true.
4. **Dedupe** (see below) against the 341 and against already-accepted new questions.
5. **Human spot-check** a random sample per batch ⟶ **HANDOFF** (fact quality and "does this
   feel like a fair question" are human calls; do not self-certify a batch as done).
6. **Append** survivors to `questions.json` with provenance; decrement the worklist.

Recommend running this as its own tracked effort (its own branch and commits per batch),
**separate from the code phases** — generating 1659 verified questions is a large, mostly
non-code execution task and should not block the Phase-1 code from landing. The code side
(schema, loader, fallback) can ship against a partial bank and the bank fills in over time;
the "2000" done-when is met when the bank is complete, gated by the spot-check handoffs.

#### Dedupe strategy
- **Exact:** normalized-prompt hash (lowercase, strip punctuation/whitespace) — reject
  collisions outright.
- **Near-duplicate:** token-set / trigram similarity over the normalized prompt against
  both the 341 and accepted new questions; anything above a threshold goes to human review
  rather than auto-accept. Also flag same-answer clusters (many questions resolving to the
  same person/team) so one entity doesn't dominate a cell.

#### Difficulty calibration
Anchor to the existing bank's felt difficulty: sample a few existing questions per level per
sport as reference exemplars, and calibrate new questions against them (1 = casual-fan
obvious, 3 = engaged-fan, 5 = deep trivia). Because levels 4–5 are only 14% combined, their
*new* counts are small (170 + 73) — recommend generating those cells last and with the most
human review, since they're the easiest to get wrong and the most visible when wrong.

#### Loader changes (`src/trivia.ts` + `src/extension.ts`)
- `TriviaStore` gains access to the bundled file. **Recommend** passing `extensionUri`/the
  `ExtensionContext` into its constructor (today it takes only `globalState` + `log`) and
  reading `data/trivia/questions.json` once, lazily, into an in-memory `bundled: TriviaQuestion[]`.
- New source precedence in `load()`:
  1. Supabase configured → fresh cache → live fetch → **stale cache** → **bundled**.
  2. Supabase **not** configured → **bundled** (the zero-config default).
  This is a small extension of the current cache→fetch→stale-cache ladder: bundled becomes
  the always-present floor, so `ensureLoaded()` effectively never returns `false` and the
  webview's "hide the Trivia tab" path becomes a rare edge (kept for safety). `invalidate()`
  keeps clearing the network/cache layers on settings change but never clears `bundled`.
- `isValidQuestion` is unchanged; run the whole bundled file through it at load and log the
  count, dropping any malformed row defensively.

#### .vsix size budget impact
At ~250 bytes/question uncompressed, 2000 questions ≈ **0.5 MB JSON**, which zip-compresses
inside the `.vsix` to roughly **120–180 KB**. Negligible next to the extension bundle; the
real size driver is the Phase-5a chess pack, budgeted there. Confirm with `vsce ls`/actual
package size in verification.

#### Risks / unknowns
- Generating 1659 *verifiable* questions is the dominant effort and the main schedule risk —
  hence the resumable worklist and the recommendation to decouple it from the code landing.
- Levels 4–5 verification is the failure-prone zone (obscure facts, borderline time-varying).
- Attribution expectations for authored questions (see Open Decisions).

#### Verification steps
- `npm run build && npm run typecheck` clean.
- Unit-level: a small node script asserts every row in `questions.json` passes
  `isValidQuestion`, `options.length === 4`, `sport ∈` the 7, `difficulty ∈ 1..5`, and that
  per-sport / per-difficulty counts match the target tables.
- Manual: launch with **no** Supabase settings, disconnect network, play 20+ trivia
  questions ⟶ **HANDOFF** (question quality/fairness is a human read).
- Manual: with Supabase set to a bad URL, confirm it falls through to the bundled bank
  rather than hiding the tab.
- `vsce ls` shows `data/trivia/questions.json` included and the package size within budget.

### 1b. Multi-window support (per-window ephemeral ports + `~/.standby/ports.json`)

**Goal.** Implement OVERVIEW.md §7's documented fix so two Cursor windows open at once both
work, while the fixed-port path still works for anyone who wants it.

#### Milestones / done-when
- Two Cursor windows open simultaneously, each with its own workspace; a Claude Code prompt
  in either window drives **only that window's** panel.
- The hook resolves the right port from `cwd` in POSIX shell, fast, still failing silently in
  <300 ms when nothing is listening.
- Stale entries are cleaned on clean close and tolerated/pruned after a crash.
- The `standby.port` fixed-port setting still works unchanged (backward compat).

#### Registry schema (`~/.standby/ports.json`)
```
{
  "version": 1,
  "windows": [
    {
      "pid":     number,        // extension-host pid, for liveness pruning
      "port":    number,        // the ephemeral port this window bound
      "folders": string[],      // absolute workspace-folder paths for this window
      "updated": number         // epoch ms, for staleness
    }
  ]
}
```
Written to `~/.standby/` (created if absent, like `~/.claude`). One array with an entry per
live window.

#### Extension side (`src/listener.ts`, `src/extension.ts`, new `src/registry.ts`)
- **Port selection.** When `standby.port` is at its new **auto** default, bind an ephemeral
  port: `server.listen(0, '127.0.0.1')` and read `server.address().port`. When
  `standby.port` is set to an explicit number, keep today's fixed-bind behavior (and today's
  "port in use → dormant + one-time warning" path) for backward compat.
- **Registration.** On successful listen, `registry.register({ pid, port, folders })` where
  `folders = workspaceFolders.map(f => f.uri.fsPath)`. On `workspaceFolders` change, update
  the entry. On dispose/`deactivate()`, `registry.unregister(pid)`.
- **Atomic, concurrency-safe writes.** Two windows may write concurrently. Read-modify-write
  with: read current file, prune dead/stale entries, upsert own entry, write to a temp file,
  `rename()` over the target (atomic on POSIX). Guard with a best-effort lock (e.g. `wx`
  lockfile with a short retry) so simultaneous starts don't clobber. Tolerate a corrupt file
  by treating it as empty and rewriting.
- **Stale-entry cleanup.** On every window startup and on each registry write, drop entries
  whose `pid` is no longer alive (`process.kill(pid, 0)` throws → dead) or whose `updated` is
  older than a generous TTL (crash without cleanup). This keeps the file self-healing without
  a daemon.

#### Hook side (`hooks/standby-hook.sh`)
This is the delicate part: the script currently streams stdin straight into `curl`
(`--data-binary @-`). To pick a port by `cwd` it must **buffer stdin first**, extract `cwd`,
resolve the port, then POST the buffered body. Plan:
1. `body=$(cat)` — buffer the hook JSON (payloads are tiny, capped 64 KB upstream).
2. Extract `cwd` with a POSIX-safe parse (no `jq` dependency): `grep`/`sed` for the
   `"cwd":"…"` field. Keep it defensive — on any parse miss, fall back to the fixed port arg.
3. Resolve the port from the registry **without requiring `jq`**. Two options:
   - **(A, recommended) Ship a companion flat lookup** the shell can `grep`: alongside
     `ports.json`, the extension also writes `~/.standby/ports.tsv` with one
     `<folder>\t<port>` line per folder per live window. The hook iterates lines and matches
     with a prefix test (`case "$cwd" in "$folder"*) port=$field ;; esac`), which is exactly
     the `cwd`-inside-folder rule the extension already uses in `cwdMatchesWorkspace`. Longest
     matching folder wins (handles nested workspaces). This avoids JSON parsing in POSIX shell
     entirely and is the fastest, most robust path.
   - **(B) Parse `ports.json` in shell** via `sed`/`awk`. Rejected as the primary approach —
     brittle and slower than a grep over a flat file.
4. POST the buffered `body` to the resolved port (or the fixed-port fallback) with the same
   `curl -s --max-time 0.3 … || true; exit 0` guarantees. If no port resolves and no
   fallback listener exists, the `curl` fails silently as today.

Latency budget: `cat` a tiny stdin + `grep` a small file + one `curl` stays well under
300 ms. The registry file is small (one line per folder per window).

#### Backward compatibility with the fixed port
- `standby.port` semantics: **recommend** changing the default to an **auto** sentinel (e.g.
  `0`) meaning "ephemeral + registry"; any explicit non-zero value forces the legacy fixed
  bind and the hook uses that value as its argument/fallback. This preserves every existing
  install: a user who set `standby.port: 48219` and installed hooks keeps working with no
  change.
- The hook script keeps its existing positional `[port]` argument as the **fallback** used
  when the registry yields no match — so an old hook line still functions, and a new hook line
  is `"…/standby-hook.sh" <fallbackPort>`.
- `HookInstaller` (`src/hooks.ts`) is unchanged in structure; it keeps writing the fallback
  port into the command. Re-running the installer after upgrade refreshes the line in place
  (idempotent marker logic already handles this).

#### Risks / unknowns
- POSIX `cwd` extraction across shells (`sh`/`dash`/`bash`) and paths with spaces — pin to
  the flat-file prefix match (option A) and test with a spaced path.
- Registry write races on simultaneous window launch — mitigated by temp-file+rename and the
  lockfile retry; verify under a two-windows-launched-together test.
- Symlinked workspace paths could defeat prefix matching — normalize with `realpath`-style
  resolution on the extension side before writing folders (the extension already
  `path.resolve`s cwd).

#### Verification steps
- Two windows, distinct workspaces: `scripts/fake-agent.sh <wsA>` and `<wsB>` drive only their
  own panels. Cross-check by posting a `cwd` from A while both are open.
- Kill one window's extension host (or `kill -9` its pid) and confirm the other window still
  works and the stale entry is pruned on next write.
- Legacy path: set `standby.port` to a fixed number, re-install hooks, confirm single-window
  behavior is byte-for-byte the old behavior.
- Timing: instrument the hook (temporarily) to confirm sub-300 ms resolution.
- ⟶ **HANDOFF:** a real two-window Cursor session for a day — does either window ever reveal
  for the other's activity? (feel/correctness read).

### 1c. Install-flow audit (stranger who read one tweet)

**Goal.** Walk the whole cold path — install `.vsix` → run hook installer → panel works —
as someone with no prior context, enumerate every rough edge, fix them, and rewrite
`README.md` for that person.

#### Known rough edges (from the current code/README) and their fixes
1. **Secondary-sidebar layout is a manual, easy-to-miss step.** Today the README tells the
   user to drag the Standby view into the secondary sidebar, and hide works by closing the
   auxiliary bar (`workbench.action.closeAuxiliaryBar`, OVERVIEW §4/§7; the FEEL.md "watch
   this" note flags historical flakiness of container-close in Cursor). **Fix:** lead the
   README with this as step 1 with a screenshot; add a first-run notice/walkthrough
   (a one-time `showInformationMessage` with a "Show me" that runs `standby.panel.focus`) so
   the panel isn't "installed but invisible". ⟶ **HANDOFF:** confirm the reveal/hide is still
   instant and reliable in current Cursor (the exact re-verify FEEL.md asks for).
2. **Hooks require restarting Claude Code** to take effect — easy to miss. **Fix:** the
   post-install message already says this; make it more prominent and add it to the README's
   critical-path checklist.
3. **"Nothing happens" has no diagnosis path.** **Fix:** add a **Standby: Show Status /
   Diagnostics** command that reports listener port, whether hooks are installed and point at
   this build's script path, last event seen, and registry contents — the one thing a
   confused installer can run and paste.
4. **Trivia previously looked broken without Supabase.** Resolved by 1a (bundled default);
   README drops "trivia needs setup" from the critical path and reframes Supabase as optional.
5. **Port/hook coupling** after changing `standby.port` (must re-run installer). **Fix:**
   detect a port/hook mismatch in diagnostics and prompt to re-install.
6. **Cursor pulls from Open VSX, not the MS marketplace** — a stranger may not know where to
   get it. **Fix (README):** the canonical install is the GitHub-release `.vsix` (Phase 2),
   with Open VSX as the secondary path.

#### README rewrite (done-when)
- Rewritten top-to-bottom for a first-timer: a one-line "what it is", a numbered
  critical-path (install `.vsix` → reload → place panel in secondary sidebar → install hooks →
  restart Claude Code → see it work), a screenshot/gif, a short troubleshooting section
  anchored on the diagnostics command, and Supabase demoted to an "optional: bring your own
  bigger bank" note.
- ⟶ **HANDOFF:** the human (or a genuinely fresh machine/user) runs the README start-to-finish
  and confirms nothing needed outside knowledge.

#### Verification steps
- Fresh-profile install test: install the `.vsix` into a clean Cursor profile, follow only the
  README, reach a working panel.
- Diagnostics command output is correct in the working case and in a deliberately broken case
  (wrong port, hooks not installed).

---

## Phase 2 — Distribution prep (prepare, do not publish)

**Goal.** Everything needed to publish is in place and one command cuts a release, but the
human runs the final publish steps. Cursor consumes Open VSX, so that plus a GitHub release
with the `.vsix` attached is the target.

#### Milestones / done-when
- `package.json` publisher metadata complete and consistent with the chosen Open VSX
  namespace (see Open Decisions); `displayName`, `description`, `categories`, `keywords`,
  `repository`, `bugs`, `homepage`, `icon` all set.
- A real extension **icon** (128×128 PNG referenced by `package.json > icon`; the current
  `media/icon.svg` stays as the activity-bar icon). ⟶ **HANDOFF:** icon design is a taste call.
- `LICENSE` present (MIT already at repo root, 2026 Charles Aschkenasy) and referenced;
  third-party attribution file for anything vendored (Lichess CC0 in Phase 5, authored trivia
  in Phase 1 — see Open Decisions).
- `CHANGELOG.md` created, `0.0.1` … first public version documented.
- CI cuts a release in one step.
- `set private:false` in `package.json` (currently `"private": true`, which blocks packaging
  for publish) — **flag as a deliberate switch**, done only at release time.

#### Technical approach / files touched
- `package.json`: metadata, `keywords`, `icon`, `bugs`, `homepage`, drop `private` at release.
- New `CHANGELOG.md`, `.github/workflows/release.yml`, optional `.github/workflows/ci.yml`
  (build + typecheck + the trivia-bank validation script on every PR).
- `NOTICE`/`THIRD-PARTY.md` for attributions.
- Confirm `.vscodeignore` excludes `PLAN.md`, `PLAN-V2.md`, `FEEL.md`, `data/` source
  worklists, and any generation tooling while **including** `data/trivia/questions.json`,
  `hooks/`, `media/`, `dist/`, `LICENSE`, `README.md`, `CHANGELOG.md`.

#### Release CI (one-step)
- **Recommend:** a tag-triggered GitHub Action (`on: push: tags: 'v*'`) that runs
  `npm ci`, `npm run build`, `npm run typecheck`, the bank-validation script, `vsce package`,
  then creates a GitHub Release and attaches the `.vsix`. Publishing to Open VSX
  (`ovsx publish`) is a **separate, gated** job that only runs if an `OVSX_PAT` secret is
  present — so CI is fully wired but the actual public push stays under the human's control
  (they add the token when ready).
- Cutting a release becomes: bump version + changelog, push a `vX.Y.Z` tag.

#### Manual steps for the human (Phase 2 publish)
1. **Choose the Open VSX namespace/publisher** (see Open Decisions) and reserve it: create an
   Eclipse Foundation account, sign the Publisher Agreement, `npx ovsx create-namespace <ns>`.
2. **Generate an Open VSX access token** (eclipse.org account → Open VSX user settings) and add
   it to the GitHub repo secrets as `OVSX_PAT` (only when ready to publish publicly).
3. **Set `package.json` `publisher`** to the reserved namespace; flip `"private": false`.
4. **Finalize the icon** and confirm it renders in the marketplace preview.
5. **Bump version + `CHANGELOG.md`**, commit, `git tag vX.Y.Z && git push --tags`.
6. **Watch the release workflow**: confirm the GitHub Release is created with the `.vsix`
   attached (this is the canonical install link).
7. **Publish to Open VSX**: with `OVSX_PAT` set, re-run/enable the gated publish job (or run
   `npx ovsx publish standby-X.Y.Z.vsix -p $OVSX_PAT` locally).
8. **(Optional) MS Marketplace**: not required for Cursor; only if broad VS Code reach is
   wanted — separate publisher + `vsce publish`. Recommend deferring.
9. **Update the README install link** to the GitHub-release `.vsix` and the Open VSX listing.

#### Risks / unknowns
- Open VSX namespace ownership/verification lead time (do it early).
- `engines.vscode ^1.85` vs. the Cursor version installers actually run — verify the floor is
  low enough; bump only if an API used requires it.

#### Verification steps
- Dry-run the release workflow on a pre-release tag; confirm the `.vsix` artifact builds in CI
  and installs cleanly from the attached file.
- `vsce ls` / package inspection shows the intended file set and size.

---

## Phase 3 — Wait-time stats (the launch feature)

**Goal.** Track wait sessions locally and surface them in the panel: total wait time today and
this week, number of waits, longest wait, time per game, trivia streak record, plus a daily
summary card clean enough to screenshot for a tweet. **No telemetry, no network, no new
badges/nudges** — the feel guarantees hold.

#### Data model
- A wait **session** starts on the first `working` transition after `done` and ends on the
  next `done`. `needsYou` time counts as part of the wait (you're still waiting on the agent).
  The `AgentStateMachine` already emits `StateChange { state, since }` — Phase 3 subscribes to
  it (like the status bar and panel already do) and records durations; **no state-machine
  changes required**.
- Persist in `globalState` under a new key (`standby.waitStats`), consistent with how best
  scores live today. Store **per-day aggregates** keyed by local date, not raw event logs, to
  keep it bounded:
  ```
  {
    version: 1,
    days: {
      "2026-08-03": { waits: n, totalMs, longestMs, byGameMs: { trivia, "2048", snake, … } }
    },
    records: { bestTriviaStreak: n }   // already tracked in bestScores; mirror/read it
  }
  ```
- **Per-game time** attribution: the webview knows which game is mounted; on the `ready`
  message and on each tab switch it already tracks `activeGame`. Have it report active-game
  duration deltas (or the extension attributes the whole wait to the game mounted at hide
  time — simpler, recommend starting there and refining if it feels wrong ⟶ HANDOFF).
- **Trivia streak record** reuses the existing `standby.bestScores.trivia` value; the stats
  view reads it rather than duplicating.

#### Aggregation & retention
- Aggregate on the fly into the per-day buckets; "today" and "this week" are computed by
  summing the relevant day keys (week = trailing 7 local days, or Mon-start — pick in the view,
  recommend trailing 7 for simplicity).
- **Retention:** keep ~90 days of day-buckets and drop older on write (bounded storage, still
  enough for "this week" and a little history). No raw session log persisted.

#### Panel surface
- A new **Stats** tab in the existing header nav (alongside Trivia/2048/Snake), implemented as
  a webview view — **not** a `GameInstance` (it's not a game), rendered by the shell directly.
  It reads a `stats` message the extension pushes on `ready` and on each `done` (so it's fresh
  when you next look). Themed entirely with `--vscode-*` vars like everything else.
- The **daily summary card** is a self-contained, well-composed block (today's total wait,
  number of waits, longest wait, top game, trivia streak record) sized and styled to look good
  as a screenshot — no external assets, no share button that phones home (a "copy card" could
  render to canvas locally, but keep v1 to "it just looks good when you screenshot it").
- ⟶ **HANDOFF:** the card looking screenshot-worthy is a pure feel judgment — build it, hand it
  over, iterate on the human's read. Same for whether per-game attribution feels right.

#### Feel pressure points (call-outs)
- **No nudges:** the Stats tab is passive — it never auto-reveals, never toasts "you waited an
  hour today", never badges the tab. It's there when you go looking.
- **Instant hide unaffected:** stats are written on the `done` transition *after* the hide is
  issued (or fire-and-forget), so persisting a stat never delays the feel-critical hide path.
- **No new state or timers** that could keep the panel open — Phase 3 is a pure observer.

#### Files touched
- New `src/stats.ts` (subscribe to `machine.onDidChange`, maintain `globalState` aggregates,
  expose a `snapshot()` the panel pushes to the webview).
- `src/panel.ts` (push `stats` on `ready`/`done`; handle a `statsRequest` message).
- `webview/index.ts` + `webview/ui.css` (Stats tab + card rendering).
- `src/extension.ts` (wire the stats module).

#### Risks / unknowns
- Attributing time to a game when multiple were played in one wait — start simple (mounted-at-
  hide), refine on feel.
- Day boundaries / timezone (use local date consistently).

#### Verification steps
- `scripts/fake-agent.sh` drives several waits; confirm counts/durations aggregate correctly
  and survive a reload (globalState persistence).
- ⟶ **HANDOFF:** a few real days of use — do the numbers feel true and is the card tweetable?

---

## Phase 4 — Apps strip

**Goal.** A slim strip of configurable quick-jump buttons (Slack, Messages, Mail, custom URLs)
that open via `vscode.env.openExternal` deep links. No accounts, no tokens, no embedded
content.

#### Milestones / done-when
- A thin strip (in the panel, e.g. under the header or as its own compact row) renders a
  user-configurable list of buttons; clicking one calls `openExternal` with its URL/deep link.
- Sensible defaults ship; the user overrides via settings.
- Nothing is embedded; no network calls from the extension itself.

#### Technical approach
- New setting `standby.apps`: an array of `{ label, url, icon? }` (icon = a codicon id or an
  emoji; keep it asset-free). Defaults: a few universal ones (e.g. Mail via `mailto:`-style or
  the Mail app deep link, Messages, Slack `slack://`, and an example custom `https://` URL) —
  **recommend conservative defaults** that work cross-platform or are obviously
  example-and-replaceable, since app deep-link schemes are OS-specific.
- Rendered by the shell (`webview/index.ts`); a click posts `{ type: 'openApp', url }` to the
  extension, which validates the scheme against a small allowlist (`https`, `mailto`, and known
  app schemes) and calls `vscode.env.openExternal(vscode.Uri.parse(url))`.
- Configurable ordering; empty list → strip hidden (no empty chrome).

#### Feel pressure points
- `openExternal` hands off to the OS/another app — that's a user-initiated action (a click), so
  it doesn't violate "focus never stolen" (nothing auto-fires). No badges/nudges on the strip.
- The strip must not compete with the game for vertical space when the panel is short —
  recommend it collapse to a single compact row and be toggle-able (`standby.apps.show`).

#### Files touched
- `package.json` (new `standby.apps` configuration).
- `webview/index.ts` + `webview/ui.css` (strip UI).
- `src/panel.ts` (`openApp` message → validated `openExternal`).

#### Risks / unknowns
- Deep-link schemes vary by OS and installed apps; a link may no-op if the app isn't installed
  (acceptable — `openExternal` handles it, no crash). Document that defaults are examples.

#### Verification steps
- Configure a custom `https://` and a `slack://` link; confirm each opens the right target and
  an unknown scheme is rejected by the allowlist.
- ⟶ **HANDOFF:** does the strip feel like a helpful convenience rather than clutter?

---

## Phase 5 — New games

All four conform to the existing `GameInstance` contract (`webview/games/types.ts`:
`root/activate()/deactivate()/handleKey()/setBest()`), theme via `--vscode-*` vars, **pause on
`deactivate()` and resume in place on `activate()`**, persist best score via
`host.reportBest(game, value)` → `globalState.standby.bestScores` (the exact path Snake/2048
use today), and register as a new tab in `webview/index.ts`'s `GAMES` list + `getInstance`
switch. Original implementations only. Build strictly in the order below; each is its own
milestone that must build clean before the next starts.

**Cross-cutting feel note for timed games (Minesweeper, Sudoku, Chess streak):** the timer must
**stop on `deactivate()`** (panel hidden / tab switched / window blurred — the shell already
calls `deactivate()` on all of these via `pauseAll`) and resume on `activate()`, so walking away
mid-puzzle never inflates a time or breaks a streak. Best time/score is recorded **only on
genuine completion**, never penalized for a hide.

### 5a. Chess tactics (Lichess puzzle DB, CC0)

#### Milestones / done-when
- A starter pack of a few thousand puzzles (mate-in-1..3, rating <1800) ships as JSON in the
  `.vsix`; one puzzle at a time renders on a board in the webview; click-to-move; instant
  right/wrong; a streak like trivia; best streak persisted.
- `npm run build && npm run typecheck` clean; pack size within the agreed budget.

#### Sourcing & bundling the CC0 data
- Source: the **Lichess open puzzle database** (CC0). It's a large CSV
  (`PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags`).
- **Filter/bundle step** (a build-time script, run once, output committed): keep rows whose
  `Themes` include `mateIn1|mateIn2|mateIn3` and `Rating < 1800`, then downsample to the target
  count (see Open Decisions — recommend a few thousand, e.g. 3000, balanced across mate-in-1/2/3
  and rating bands). Emit `data/chess/puzzles.json` with only the fields the game needs:
  `{ id, fen, moves, rating, mateIn }` (drop URLs/opening tags to save space).
- **Attribution:** Lichess puzzles are CC0 (no attribution legally required) — still, credit
  Lichess in `THIRD-PARTY.md`/README as good practice (see Open Decisions).
- **Size budget:** ~3000 puzzles × ~80 bytes (FEN + a short move list + ints) ≈ 240 KB JSON →
  ~60–90 KB compressed in the `.vsix`. This plus trivia keeps the data footprint well under a
  megabyte compressed; confirm against the agreed `.vsix` budget.

#### Board rendering & move validation
- **Rendering:** a CSS/DOM 8×8 board (no image assets) with Unicode chess glyphs or
  CSS-drawn pieces, themed via `--vscode-*`. Click a source square then a target square to move
  (highlight legal targets for the selected piece).
- **Move validation:** the puzzle gives the solution line (`moves`), so full legal-move
  generation isn't strictly required — validate the player's move against the expected solution
  move for the current ply (right → advance, play the opponent's reply from the line, continue;
  wrong → mark wrong, reset streak). **Recommend** a light move model (parse FEN, know piece
  movement enough to show candidate targets and to accept promotions/castling as encoded in the
  solution) rather than a full engine — no external chess library, keeping the bundle
  framework-free and small. Note the trade-off in Open Decisions if fuller free-play is wanted.
- ⟶ **HANDOFF:** board feel (piece legibility in dark/light, click targets, right/wrong feedback)
  is a taste judgment.

#### Risks / unknowns
- Hand-rolling just-enough move logic for click targets + promotion/castling from the solution
  line; keep puzzles to mate-in-1..3 to bound complexity.
- Puzzle data licensing is CC0 (clear); attribution is courtesy only.

#### Verification
- Play through 20+ puzzles across mate-in-1/2/3; wrong moves reset the streak; best streak
  persists across reload; timer/streak unaffected by hiding mid-puzzle.

### 5b. Minesweeper

- Classic rules, **9×9 / 10 mines** default; left-click reveal, **right-click flag**, flood-fill
  on zero, first-click-safe; a **timer**; best time persisted (per the default board).
- `GameInstance`: `deactivate()` pauses the timer, `activate()` resumes; best time recorded only
  on a genuine win.
- CSS/DOM grid, themed; no assets. Files: `webview/games/minesweeper.ts` + tab wiring + CSS.
- Verify: win/lose flows, flag counting, timer pause-on-hide, best-time persistence.
- ⟶ **HANDOFF:** feel (cell size, colors, flag interaction).

### 5c. Klondike solitaire (its own milestone — most complex)

- Full click-to-move (and optionally drag), 52-card **CSS-rendered** deck (no image assets),
  **undo**, **win detection**, games-won counter persisted.
- Standard Klondike: stock/waste (draw-1 or draw-3 — recommend draw-1 default, simpler and
  friendlier), 7 tableau piles, 4 foundations.
- `GameInstance`: state is turn-based, so `deactivate()` need only stop any animation; the deal
  survives hide/resume in place (webview retained).
- Treat as a standalone milestone: card model, move legality, undo stack, auto-move-to-foundation
  convenience, win animation (subtle, no sound). Files: `webview/games/klondike.ts` + CSS + tab.
- Verify: a full game to a win updates the games-won counter; undo restores exactly; deal resumes
  in place after a hide.
- ⟶ **HANDOFF:** card legibility and move feel (this one lives or dies on feel).

### 5d. Sudoku (real generator)

- A **real generator** producing unique-solution puzzles at **easy/medium/hard** (not a fixed
  list); **pencil marks**; an **error-highlighting toggle**; **best time per difficulty**
  persisted.
- Generator: build a full solved grid (backtracking), dig cells while preserving a unique
  solution (solver-count check), difficulty = number/pattern of givens + technique required.
  All in-webview, no assets/library.
- `GameInstance`: timer pauses on `deactivate()`, resumes on `activate()`; best time per
  difficulty recorded on genuine completion.
- Files: `webview/games/sudoku.ts` + CSS + tab; best scores keyed per difficulty
  (`sudoku:easy`, etc.) within the existing bestScores map.
- Verify: generated puzzles always have a unique solution (assert via the solver), pencil marks
  and error toggle work, per-difficulty best times persist and pause correctly on hide.
- ⟶ **HANDOFF:** difficulty calibration (does "hard" feel hard?) and overall feel.

---

## Open decisions (need the human before/during execution)

1. **.vsix size budget.** Trivia ≈120–180 KB compressed; chess ≈60–90 KB; total data well under
   1 MB compressed. **Recommend a soft cap of ~2 MB total `.vsix`.** Confirm the cap so chess
   puzzle count and any future data can be sized against it.
2. **Trivia bank completeness vs. code landing.** Recommend landing the Phase-1a *code* (schema,
   loader, bundled fallback) against a partial bank and filling to 2000 via the batched pipeline
   as a parallel effort. Confirm this decoupling, and confirm the 2000 target itself.
3. **Question-generation pipeline structure.** Recommend the resumable 35-cell worklist +
   per-batch web-verify + dedupe + human spot-check, tracked on its own branch with per-batch
   commits. Confirm the process and who does the spot-check handoffs.
4. **Chess puzzle count.** Recommend ~3000 (balanced across mate-in-1/2/3, rating <1800).
   Confirm the count against the size cap.
5. **Chess move model depth.** Recommend just-enough movement logic driven by the solution line
   (no chess library, no full free-play). Confirm this is acceptable vs. wanting fuller board
   interaction.
6. **Open VSX namespace / publisher name.** Current `package.json` publisher is
   `charlieaschkenasy`; repo is `github.com/charlie-aschkenasy/while-wait`. Decide the Open VSX
   namespace and whether to keep this publisher id. Needed before Phase 2.
7. **Attribution requirements.**
   - **Lichess (CC0):** no legal attribution required; recommend a courtesy credit in
     `THIRD-PARTY.md`/README. Confirm.
   - **Authored trivia:** decide whether to ship per-question `source_url` in the public data
     (transparency, larger file) or keep sources in a private worklist and ship a general
     "questions authored and fact-checked for this project" note. Recommend keeping `source_url`
     in the data — it's small and it's the honesty story for a trivia app.
8. **Keep the fixed-port fallback?** Recommend **yes** — change the default to an `auto`
   sentinel (ephemeral + registry) but keep an explicit `standby.port` forcing the legacy fixed
   bind, so existing installs and single-window users are undisturbed. Confirm.
9. **Stats per-game attribution model.** Recommend starting with "mounted-at-hide" attribution
   and refining on feel. Confirm the simple start is acceptable.
10. **Apps-strip default list.** App deep-link schemes are OS-specific; recommend conservative,
    obviously-example defaults plus a clear "edit `standby.apps`" pointer. Confirm the default set.
11. **Secondary-sidebar dependency.** The hide mechanism still closes the auxiliary bar
    (OVERVIEW §7, FEEL.md re-verify). Every new surface (Stats tab, apps strip) lives inside the
    same retained webview, so this constraint is unchanged — but confirm we're not adding a
    second view that would be collateral-hidden.

---

## What stays fixed (guardrails for every phase)

- The three-state machine (`working/done/needsYou`), the 300 ms Stop debounce, and the 30-min
  stuck-working watchdog are unchanged; new features **observe** state, never drive it.
- **Instant hide** is never delayed by new work (stats writes, registry writes) — those happen
  after/around the hide, fire-and-forget.
- Focus is never stolen; nothing auto-reveals except the existing `working`/`needsYou` reveals;
  no sounds, toasts, badges, or nudges are introduced by any phase.
- Games (old and new) pause on `deactivate()` and resume in place via the retained webview.
- Fully offline except the **optional** Supabase trivia override; no accounts, auth, or
  telemetry anywhere.
