// Shared, type-only module imported by BOTH the node bundle (src/stats.ts) and
// the browser bundle (webview/stats.ts) so the snapshot shape can never drift.
// Type-only ⇒ esbuild erases it in both bundles; no node code leaks into the
// webview.

export interface StatsDayTotals {
  totalMs: number;
  waits: number;
  longestMs: number;
  byGameMs: Record<string, number>;
}

export interface StatsSnapshot {
  today: StatsDayTotals & { topGame: string | null };
  week: StatsDayTotals;
  bestTriviaStreak: number;
}

/** Persisted shape under globalState key `standby.waitStats`. */
export interface StatsData {
  version: 1;
  days: Record<string, StatsDayTotals>;
}
