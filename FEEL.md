# FEEL.md — dogfooding log

Running list of irritations noticed during daily use. Anything that annoys you,
write it down here (or tell Claude and it gets added). M6 is done when a few
days pass without a new entry.

Guardrails already in place:

- Hide is instant (view removed via context key; latency logged in the Standby
  output channel as `hide: … in Nms`).
- Appear is a soft 150ms fade; disappear has no animation.
- `working` decays to `done` after 30 min with no events (crashed session).
- Panel never appears while the Cursor window is unfocused; it catches up when
  you come back if the wait is still on.
- No sounds, no toasts, no badges.

## Open irritations

- (none yet)

## Fixed

- Needs-you surface stuck forever — `[hidden]` lost to `display: flex` (M2).
- Hide killed the terminal / didn't work at all — container-close commands are
  unreliable in Cursor; switched to a `when`-clause context key (M3).
