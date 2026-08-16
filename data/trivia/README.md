# Bundled trivia bank

`questions.json` ships inside the `.vsix` and is the always-present offline floor
for the Trivia game. When a user has no `standby.supabase.*` settings, the extension
plays entirely from this file — no network, first launch. When Supabase *is*
configured, the live bank is used and this file is the final fallback (after the
network fetch and the stale cache) so trivia never becomes unavailable.

Loaded extension-side by `TriviaStore.loadBundled()` (`src/trivia.ts`) via
`context.asAbsolutePath('data/trivia/questions.json')` + `fs.readFileSync`.

## File form

Either a bare array of question objects, or the wrapped form (preferred, so a
future schema bump is detectable):

```json
{ "version": 1, "questions": [ /* … */ ] }
```

Both `scripts/validate-trivia.mjs` and the runtime loader accept both forms —
keep them in lockstep.

## Question schema

| Field | Type | Notes |
|---|---|---|
| `id` | string | Non-empty, globally unique. Stable slug (e.g. `bkb-0412`). |
| `prompt` | string | The question text. |
| `options` | string[4] | Exactly four choices. |
| `correct_index` | 0..3 | Index into `options`. |
| `sport` | enum | One of: Fighting, Soccer, Hockey, Basketball, Golf, Baseball, Football. |
| `difficulty` | integer 1..5 | 1 = casual-fan obvious, 3 = engaged-fan, 5 = deep trivia. |
| `source_url` | string | *Optional, authored questions only.* The verification source. Ignored at runtime. |
| `verified_on` | `YYYY-MM-DD` | *Optional, authored questions only.* When it was fact-checked. Ignored at runtime. |

`source_url` / `verified_on` carry the fact-check trail with the data. They are
optional and ignored by the runtime validator (`isValidQuestion`), but the shipped
bank is validated more strictly than the runtime accepts (see below).

## Validation

`scripts/validate-trivia.mjs` is the landing gate for every batch. It enforces the
runtime predicate **plus** the stricter bundled invariants (`options.length === 4`,
known `sport`, integer `difficulty` 1..5, non-empty unique `id`):

```sh
node scripts/validate-trivia.mjs data/trivia/questions.json
node scripts/validate-trivia.mjs data/trivia/questions.json --targets   # check PLAN-V2 §1a counts
```

Exits non-zero and names the first offending `id` on any failure.

## Authoring rules

- **Settled history only** — completed careers, finals results, retired records,
  rule facts, founding dates. **Forbid time-varying answers**: current rosters,
  "active leader", records still being chased, "most X ever" for a live stat (the
  Ovechkin trap). Prefer questions whose answer was true 5 years ago and will be
  true in 5 years.
- **Verify every candidate** with a reputable source before inclusion; record
  `source_url` + `verified_on`. Uncorroborated → discarded, not softened.
