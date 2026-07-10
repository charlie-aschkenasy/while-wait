import { GameHost, GameInstance } from './types';

const SIZE = 4;
const SLIDE_MS = 120;

interface Tile {
  value: number;
  row: number;
  col: number;
  el: HTMLElement;
  merged: boolean;
}

const KEY_DIRS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  w: [-1, 0],
  s: [1, 0],
  a: [0, -1],
  d: [0, 1],
};

export class Game2048 implements GameInstance {
  readonly root = document.createElement('div');

  private readonly layer = document.createElement('div');
  private readonly scoreEl = document.createElement('span');
  private readonly bestEl = document.createElement('span');
  private readonly overlay = document.createElement('div');

  private grid: (Tile | null)[][] = [];
  private score = 0;
  private best: number;
  private over = false;

  constructor(private readonly host: GameHost, best: number) {
    this.best = best;

    this.root.className = 'game';
    const header = document.createElement('div');
    header.className = 'game-header';
    this.scoreEl.className = 'game-score';
    this.bestEl.className = 'game-best';
    header.append(this.scoreEl, this.bestEl);

    const board = document.createElement('div');
    board.className = 'board-2048';
    for (let i = 0; i < SIZE * SIZE; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell-2048';
      board.appendChild(cell);
    }
    this.layer.className = 'tiles-2048';
    this.overlay.className = 'game-overlay';
    this.overlay.hidden = true;
    board.append(this.layer, this.overlay);

    this.root.append(header, board);
    this.overlay.addEventListener('click', () => this.newGame());

    this.newGame();
  }

  activate(): void {}

  deactivate(): void {
    // Turn-based: nothing to freeze.
  }

  setBest(value: number): void {
    if (value > this.best) {
      this.best = value;
      this.updateHeader();
    }
  }

  handleKey(e: KeyboardEvent): boolean {
    if (this.over && (e.key === ' ' || e.key === 'Enter')) {
      this.newGame();
      return true;
    }
    const dir = KEY_DIRS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!dir || this.over) {
      return false;
    }
    this.move(dir[0], dir[1]);
    return true;
  }

  private newGame(): void {
    this.layer.innerHTML = '';
    this.grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    this.score = 0;
    this.over = false;
    this.overlay.hidden = true;
    this.spawn();
    this.spawn();
    this.updateHeader();
  }

  private move(dr: number, dc: number): void {
    // Traverse from the edge tiles move toward, so blockers settle first.
    const rows = dr === 1 ? [3, 2, 1, 0] : [0, 1, 2, 3];
    const cols = dc === 1 ? [3, 2, 1, 0] : [0, 1, 2, 3];
    let moved = false;

    for (const row of this.grid) {
      for (const t of row) {
        if (t) {
          t.merged = false;
        }
      }
    }

    for (const r of rows) {
      for (const c of cols) {
        const tile = this.grid[r][c];
        if (!tile) {
          continue;
        }
        let nr = r;
        let nc = c;
        while (this.inBounds(nr + dr, nc + dc) && !this.grid[nr + dr][nc + dc]) {
          nr += dr;
          nc += dc;
        }
        const target = this.inBounds(nr + dr, nc + dc)
          ? this.grid[nr + dr][nc + dc]
          : null;

        if (target && target.value === tile.value && !target.merged) {
          // Slide into the target, then absorb.
          this.grid[r][c] = null;
          this.position(tile, target.row, target.col);
          target.value *= 2;
          target.merged = true;
          this.score += target.value;
          const absorbed = tile.el;
          setTimeout(() => {
            absorbed.remove();
            this.style(target);
            target.el.classList.remove('bump');
            void target.el.offsetWidth; // restart the animation
            target.el.classList.add('bump');
          }, SLIDE_MS);
          moved = true;
        } else if (nr !== r || nc !== c) {
          this.grid[nr][nc] = tile;
          this.grid[r][c] = null;
          this.position(tile, nr, nc);
          moved = true;
        }
      }
    }

    if (moved) {
      this.updateHeader();
      setTimeout(() => {
        this.spawn();
        if (this.isStuck()) {
          this.end();
        }
      }, SLIDE_MS);
    }
  }

  private spawn(): void {
    const free: [number, number][] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!this.grid[r][c]) {
          free.push([r, c]);
        }
      }
    }
    if (free.length === 0) {
      return;
    }
    const [r, c] = free[Math.floor(Math.random() * free.length)];
    const el = document.createElement('div');
    const tile: Tile = {
      value: Math.random() < 0.9 ? 2 : 4,
      row: r,
      col: c,
      el,
      merged: false,
    };
    this.style(tile);
    el.classList.add('new');
    this.position(tile, r, c);
    this.layer.appendChild(el);
    this.grid[r][c] = tile;
  }

  private isStuck(): boolean {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const tile = this.grid[r][c];
        if (!tile) {
          return false;
        }
        if (
          (this.inBounds(r + 1, c) && this.grid[r + 1][c]?.value === tile.value) ||
          (this.inBounds(r, c + 1) && this.grid[r][c + 1]?.value === tile.value)
        ) {
          return false;
        }
      }
    }
    return true;
  }

  private end(): void {
    this.over = true;
    if (this.score > this.best) {
      this.best = this.score;
      this.host.reportBest('2048', this.best);
      this.updateHeader();
    }
    this.overlay.textContent = `game over — ${this.score} · click for a new game`;
    this.overlay.hidden = false;
  }

  private style(tile: Tile): void {
    const capped = Math.min(tile.value, 4096);
    tile.el.className = `tile-2048 tile-v${capped}`;
    tile.el.textContent = String(tile.value);
  }

  private position(tile: Tile, row: number, col: number): void {
    tile.row = row;
    tile.col = col;
    tile.el.style.setProperty('--r', String(row));
    tile.el.style.setProperty('--c', String(col));
  }

  private inBounds(r: number, c: number): boolean {
    return r >= 0 && c >= 0 && r < SIZE && c < SIZE;
  }

  private updateHeader(): void {
    this.scoreEl.textContent = `score ${this.score}`;
    this.bestEl.textContent = `best ${this.best}`;
  }
}
