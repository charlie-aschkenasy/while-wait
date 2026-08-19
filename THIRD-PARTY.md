# Third-party notices

Standby's own source code is licensed under the MIT License (see `LICENSE`,
Copyright (c) 2026 Charles Aschkenasy). This file records third-party or derived
content bundled with the extension.

## Games

- **2048** and **Snake** are original implementations written for this repository.
  2048 is *inspired by* Gabriele Cirulli's game (an original independent
  implementation, not a port or copy of its code).

## Trivia questions

The bundled trivia bank (`data/trivia/questions.json`) consists of questions
authored and fact-checked for this project. No third-party question database is
redistributed.

> **Pending (Phase 1a / Open Decision 7):** if authored questions ship with
> per-question provenance (`source_url` / `verified_on`), note here whether the
> public data carries those fields or whether sources are kept in a private
> worklist with a general "authored and fact-checked" statement. The current seed
> ships without per-question sources.

## Chess puzzles

> **Pending (Phase 5a):** the chess tactics game will bundle a filtered subset of
> the [Lichess open puzzle database](https://database.lichess.org/#puzzles), which
> is released under **CC0** (public domain — no attribution legally required). A
> courtesy credit to Lichess will be added here when that data lands.
