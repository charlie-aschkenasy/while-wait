import { GameHost, GameInstance, themeColor } from './types';

const GRID = 16;
const CANVAS_PX = 320;
const CELL = CANVAS_PX / GRID;
const TICK_MS = 110;

type Point = { x: number; y: number };
type Status = 'idle' | 'running' | 'paused' | 'dead';

const KEY_DIRS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

export class SnakeGame implements GameInstance {
  readonly root = document.createElement('div');

  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly scoreEl = document.createElement('span');
  private readonly bestEl = document.createElement('span');
  private readonly overlay = document.createElement('div');

  private snake: Point[] = [];
  private dir: Point = { x: 1, y: 0 };
  private nextDir: Point = { x: 1, y: 0 };
  private food: Point = { x: 0, y: 0 };
  private score = 0;
  private best: number;
  private status: Status = 'idle';
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly host: GameHost, best: number) {
    this.best = best;

    this.root.className = 'game';
    const header = document.createElement('div');
    header.className = 'game-header';
    this.scoreEl.className = 'game-score';
    this.bestEl.className = 'game-best';
    header.append(this.scoreEl, this.bestEl);

    const stage = document.createElement('div');
    stage.className = 'game-stage';
    this.canvas.width = CANVAS_PX;
    this.canvas.height = CANVAS_PX;
    this.canvas.className = 'snake-canvas';
    this.overlay.className = 'game-overlay';
    stage.append(this.canvas, this.overlay);

    this.root.append(header, stage);
    stage.addEventListener('click', () => this.begin());

    this.reset();
    this.showOverlay('click or press an arrow key to start');
    this.updateHeader();
  }

  activate(): void {
    this.draw();
  }

  deactivate(): void {
    this.pause();
  }

  pause(): void {
    if (this.status === 'running') {
      this.stopTimer();
      this.status = 'paused';
      this.showOverlay('paused — press a key to resume');
    }
  }

  setBest(value: number): void {
    if (value > this.best) {
      this.best = value;
      this.updateHeader();
    }
  }

  handleKey(e: KeyboardEvent): boolean {
    const dir = KEY_DIRS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (this.status !== 'running') {
      if (dir || e.key === ' ' || e.key === 'Enter') {
        this.begin(dir);
        return true;
      }
      return false;
    }
    if (!dir) {
      return false;
    }
    // Ignore reversals relative to the direction we're actually moving.
    if (dir.x !== -this.dir.x || dir.y !== -this.dir.y) {
      this.nextDir = dir;
    }
    return true;
  }

  private begin(dir?: Point): void {
    if (this.status === 'running') {
      return;
    }
    if (this.status === 'dead') {
      this.reset();
    }
    if (dir && (dir.x !== -this.dir.x || dir.y !== -this.dir.y)) {
      this.nextDir = dir;
    }
    this.status = 'running';
    this.hideOverlay();
    this.stopTimer();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.draw();
  }

  private reset(): void {
    const mid = Math.floor(GRID / 2);
    this.snake = [
      { x: mid, y: mid },
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
    ];
    this.dir = { x: 1, y: 0 };
    this.nextDir = { x: 1, y: 0 };
    this.score = 0;
    this.status = 'idle';
    this.spawnFood();
    this.updateHeader();
  }

  private tick(): void {
    this.dir = this.nextDir;
    const head = {
      x: this.snake[0].x + this.dir.x,
      y: this.snake[0].y + this.dir.y,
    };

    const hitsWall = head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID;
    // The tail cell vacates this tick unless we're eating, so exclude it.
    const body = head.x === this.food.x && head.y === this.food.y
      ? this.snake
      : this.snake.slice(0, -1);
    const hitsSelf = body.some((p) => p.x === head.x && p.y === head.y);
    if (hitsWall || hitsSelf) {
      this.die();
      return;
    }

    this.snake.unshift(head);
    if (head.x === this.food.x && head.y === this.food.y) {
      this.score += 1;
      this.updateHeader();
      this.spawnFood();
    } else {
      this.snake.pop();
    }
    this.draw();
  }

  private die(): void {
    this.stopTimer();
    this.status = 'dead';
    if (this.score > this.best) {
      this.best = this.score;
      this.host.reportBest('snake', this.best);
      this.updateHeader();
    }
    this.showOverlay(`game over — ${this.score} · press a key`);
  }

  private spawnFood(): void {
    const free: Point[] = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!this.snake.some((p) => p.x === x && p.y === y)) {
          free.push({ x, y });
        }
      }
    }
    this.food = free[Math.floor(Math.random() * free.length)] ?? { x: 0, y: 0 };
  }

  private draw(): void {
    const bg = themeColor('--vscode-editorWidget-background', '#252526');
    const snakeColor = themeColor('--vscode-charts-green', '#89d185');
    const foodColor = themeColor('--vscode-charts-red', '#f48771');

    const ctx = this.ctx;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

    ctx.fillStyle = foodColor;
    this.cell(this.food, 3);

    ctx.fillStyle = snakeColor;
    for (const p of this.snake) {
      this.cell(p, 2);
    }
  }

  private cell(p: Point, radius: number): void {
    this.ctx.beginPath();
    this.ctx.roundRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2, radius);
    this.ctx.fill();
  }

  private updateHeader(): void {
    this.scoreEl.textContent = `score ${this.score}`;
    this.bestEl.textContent = `best ${this.best}`;
  }

  private showOverlay(text: string): void {
    this.overlay.textContent = text;
    this.overlay.hidden = false;
  }

  private hideOverlay(): void {
    this.overlay.hidden = true;
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
