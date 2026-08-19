import * as vscode from 'vscode';
import { AgentStateMachine, StateChange } from './state';
import { StatsData, StatsDayTotals, StatsSnapshot } from './statsTypes';

const STATS_KEY = 'standby.waitStats';
const BEST_SCORES_KEY = 'standby.bestScores';
const RETENTION_DAYS = 90;
// A session at/over this long is almost certainly the 30-min stuck-working
// watchdog firing, not a real wait — discard it so the card never shows a bogus
// ~30-min "longest wait". (Mirrors STUCK_WORKING_MS, which state.ts keeps private.)
const MAX_SESSION_MS = 30 * 60 * 1000;

/** Local YYYY-MM-DD (NOT toISOString, which is UTC and would misattribute near midnight). */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyDay(): StatsDayTotals {
  return { totalMs: 0, waits: 0, longestMs: 0, byGameMs: {} };
}

/**
 * Observes the agent state machine and aggregates wait time into per-day buckets
 * in globalState. A PURE OBSERVER — never calls machine.handle, never drives
 * state. A wait session opens on the first non-`done` transition and closes on
 * the next `done`; needsYou time is folded into the enclosing wait. Persistence
 * is fire-and-forget so the instant-hide path is never delayed.
 */
export class WaitStats implements vscode.Disposable {
  private data: StatsData;
  private sessionStartMs: number | null = null;
  private currentGame: string | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidUpdate = this.emitter.event;

  constructor(
    machine: AgentStateMachine,
    private readonly globalState: vscode.Memento,
    private readonly log: (line: string) => void
  ) {
    const persisted = globalState.get<StatsData>(STATS_KEY);
    this.data =
      persisted && persisted.version === 1 && persisted.days
        ? persisted
        : { version: 1, days: {} };
    this.disposables.push(machine.onDidChange((c) => this.onState(c)));
  }

  private onState(change: StateChange): void {
    if (change.state !== 'done') {
      // First non-done transition opens a session; later ones (needsYou re-fires,
      // working↔needsYou) are folded into the same wait.
      if (this.sessionStartMs === null) {
        this.sessionStartMs = change.since;
      }
      return;
    }
    // done: close any open session.
    if (this.sessionStartMs === null) {
      return;
    }
    const duration = Math.max(0, change.since - this.sessionStartMs);
    this.sessionStartMs = null;
    if (duration >= MAX_SESSION_MS) {
      this.log(`stats: discarding ${Math.round(duration / 1000)}s session (watchdog cap)`);
    } else {
      this.recordWait(duration, change.since);
    }
    this.emitter.fire();
    this.persist();
  }

  private recordWait(durationMs: number, atMs: number): void {
    const key = localDateKey(new Date(atMs));
    const bucket = (this.data.days[key] ??= emptyDay());
    bucket.waits++;
    bucket.totalMs += durationMs;
    bucket.longestMs = Math.max(bucket.longestMs, durationMs);
    if (this.currentGame) {
      bucket.byGameMs[this.currentGame] = (bucket.byGameMs[this.currentGame] ?? 0) + durationMs;
    }
    this.pruneOldDays();
  }

  private pruneOldDays(): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffKey = localDateKey(cutoff);
    for (const key of Object.keys(this.data.days)) {
      if (key < cutoffKey) {
        delete this.data.days[key];
      }
    }
  }

  private persist(): void {
    // Fire-and-forget: the instant-hide path must never await a stats write.
    void this.globalState.update(STATS_KEY, this.data);
  }

  /** Called from the webview so per-game time attributes to the mounted game. */
  setActiveGame(game: string): void {
    this.currentGame = game || null;
  }

  snapshot(): StatsSnapshot {
    const now = new Date();
    const todayBucket = this.data.days[localDateKey(now)] ?? emptyDay();

    // Trailing 7 local days (including today).
    const week = emptyDay();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const b = this.data.days[localDateKey(d)];
      if (!b) {
        continue;
      }
      week.waits += b.waits;
      week.totalMs += b.totalMs;
      week.longestMs = Math.max(week.longestMs, b.longestMs);
      for (const [game, ms] of Object.entries(b.byGameMs)) {
        week.byGameMs[game] = (week.byGameMs[game] ?? 0) + ms;
      }
    }

    let topGame: string | null = null;
    let topMs = 0;
    for (const [game, ms] of Object.entries(todayBucket.byGameMs)) {
      if (ms > topMs) {
        topMs = ms;
        topGame = game;
      }
    }

    const bestScores = this.globalState.get<Record<string, number>>(BEST_SCORES_KEY, {});
    return {
      today: { ...todayBucket, topGame },
      week,
      bestTriviaStreak: bestScores['trivia'] ?? 0,
    };
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.emitter.dispose();
  }
}
