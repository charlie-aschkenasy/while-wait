# FEEL.md — dogfooding log

Running list of irritations noticed during daily use. Anything that annoys you,
write it down here (or tell Claude and it gets added). M6 is done when a few
days pass without a new entry.

Guardrails already in place:

- Hide is instant (auxiliary bar closed; latency logged in the Standby output
  channel as `hide: … in Nms`). The webview is kept alive while hidden
  (`retainContextWhenHidden`) so games resume in place on the next reveal.
- Appear is a soft 150ms fade; disappear has no animation.
- `working` decays to `done` after 30 min with no events (crashed session).
- Panel never appears while the Cursor window is unfocused; it catches up when
  you come back if the wait is still on.
- No sounds, no toasts, no badges.

## Open irritations

- **Watch this:** hide was switched from the `when`-clause context key back to
  `workbench.action.closeAuxiliaryBar` so the webview can be retained (the
  context-key hide disposed it, causing multi-second reveals + games restarting
  instead of resuming). Earlier dogfooding had found container-close commands
  unreliable in Cursor (see Fixed, below) — re-verify that hide is still instant
  and reliable, and that reveal genuinely resumes the paused game.

## Fixed

- Needs-you surface stuck forever — `[hidden]` lost to `display: flex` (M2).
- Hide killed the terminal / didn't work at all — container-close commands were
  unreliable in Cursor; switched to a `when`-clause context key (M3). **Later
  reverted:** the context key disposed the webview, so hide now uses
  `closeAuxiliaryBar` with `retainContextWhenHidden` for instant, stateful
  resume (see Open irritations to re-verify reliability).
