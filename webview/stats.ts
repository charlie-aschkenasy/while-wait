import { StatsSnapshot } from '../src/statsTypes';

const GAME_LABELS: Record<string, string> = {
  trivia: 'Trivia',
  '2048': '2048',
  snake: 'Snake',
};

function label(game: string): string {
  return GAME_LABELS[game] ?? game;
}

function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '—';
  }
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m`;
  }
  return `${s}s`;
}

/**
 * Renders the Stats surface: a screenshot-clean daily summary card plus a
 * compact "this week" total and per-game breakdown. Not a GameInstance — it is
 * not a game. Vanilla DOM, all colors from --vscode-* tokens (styled in ui.css).
 */
export class StatsView {
  readonly root: HTMLElement;
  private snapshot: StatsSnapshot | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'stats';
    this.render();
  }

  setSnapshot(s: StatsSnapshot): void {
    this.snapshot = s;
    this.render();
  }

  private render(): void {
    const s = this.snapshot;
    if (!s) {
      this.root.innerHTML = '<div class="stats-card"><p class="stats-empty">Loading…</p></div>';
      return;
    }

    const t = s.today;
    const card =
      t.waits === 0
        ? `<p class="stats-empty">No waits yet today</p>`
        : `<div class="stats-tiles">
             ${tile('Waited today', formatDuration(t.totalMs))}
             ${tile('Waits', String(t.waits))}
             ${tile('Longest wait', formatDuration(t.longestMs))}
             ${tile('Top game', t.topGame ? label(t.topGame) : '—')}
             ${tile('Best trivia streak', String(s.bestTriviaStreak))}
           </div>`;

    const weekGames = Object.entries(s.week.byGameMs).sort((a, b) => b[1] - a[1]);
    const maxGameMs = weekGames.reduce((mx, [, ms]) => Math.max(mx, ms), 0);
    const breakdown = weekGames
      .map(
        ([game, ms]) => `
        <div class="stats-bar-row">
          <span class="stats-bar-label">${label(game)}</span>
          <span class="stats-bar-track">
            <span class="stats-bar-fill" style="width:${maxGameMs ? Math.round((ms / maxGameMs) * 100) : 0}%"></span>
          </span>
          <span class="stats-bar-value">${formatDuration(ms)}</span>
        </div>`
      )
      .join('');

    this.root.innerHTML = `
      <div class="stats-card">
        <h2 class="stats-card-title">Today</h2>
        ${card}
      </div>
      <div class="stats-week">
        <h3 class="stats-week-title">This week</h3>
        <div class="stats-week-summary">
          <span>${formatDuration(s.week.totalMs)} waited</span>
          <span>${s.week.waits} wait${s.week.waits === 1 ? '' : 's'}</span>
          <span>longest ${formatDuration(s.week.longestMs)}</span>
        </div>
        ${breakdown || '<p class="stats-empty">No game time yet this week</p>'}
      </div>
    `;
  }
}

function tile(label: string, value: string): string {
  return `<div class="stats-tile">
    <span class="stats-tile-value">${value}</span>
    <span class="stats-tile-label">${label}</span>
  </div>`;
}
