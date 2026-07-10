import { Game2048 } from './games/g2048';
import { SnakeGame } from './games/snake';
import { TriviaGame } from './games/trivia';
import { GameHost, GameInstance } from './games/types';

type AgentState = 'working' | 'done' | 'needsYou';
type GameId = 'trivia' | '2048' | 'snake';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): { activeGame?: GameId } | undefined;
  setState(state: { activeGame?: GameId }): void;
};

const vscode = acquireVsCodeApi();
const app = document.getElementById('app')!;

const GAMES: { id: GameId; label: string }[] = [
  { id: 'trivia', label: 'Trivia' },
  { id: '2048', label: '2048' },
  { id: 'snake', label: 'Snake' },
];

const STATE_LABEL: Record<AgentState, string> = {
  working: 'working',
  done: 'done',
  needsYou: 'needs you',
};

let agentState: AgentState = 'done';
let needsYouMessage = '';
let activeGame: GameId = vscode.getState()?.activeGame ?? 'trivia';
let bestScores: Record<string, number> = {};

let triviaAvailable = true;

const host: GameHost = {
  reportBest(game, value) {
    bestScores[game] = value;
    vscode.postMessage({ type: 'score', game, value });
  },
  requestTrivia() {
    vscode.postMessage({ type: 'triviaNext' });
  },
};

const instances = new Map<GameId, GameInstance>();
let mounted: GameInstance | null = null;

function getInstance(id: GameId): GameInstance | null {
  if (id === 'trivia' && !triviaAvailable) {
    return null;
  }
  let instance = instances.get(id);
  if (!instance) {
    instance =
      id === 'snake'
        ? new SnakeGame(host, bestScores['snake'] ?? 0)
        : id === '2048'
          ? new Game2048(host, bestScores['2048'] ?? 0)
          : new TriviaGame(host, bestScores['trivia'] ?? 0);
    instances.set(id, instance);
  }
  return instance;
}

function buildShell(): void {
  app.innerHTML = `
    <header class="topbar">
      <span class="state-dot" id="state-dot"></span>
      <span class="state-label" id="state-label"></span>
      <nav class="tabs" id="tabs">
        ${GAMES.map(
          (g) => `<button class="tab" data-game="${g.id}">${g.label}</button>`
        ).join('')}
      </nav>
    </header>
    <main class="content">
      <section id="game-area"></section>
      <section id="needs-you" class="needs-you" hidden>
        <p class="needs-you-message" id="needs-you-message"></p>
        <button class="primary-button" id="go-to-terminal">Go to terminal</button>
      </section>
    </main>
  `;

  document.getElementById('tabs')!.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.tab');
    if (button) {
      activeGame = button.dataset.game as GameId;
      vscode.setState({ activeGame });
      update();
    }
  });

  document.getElementById('go-to-terminal')!.addEventListener('click', () => {
    vscode.postMessage({ type: 'focusTerminal' });
  });
}

function update(): void {
  const dot = document.getElementById('state-dot')!;
  dot.className = `state-dot ${agentState}`;
  dot.title = STATE_LABEL[agentState];
  document.getElementById('state-label')!.textContent = STATE_LABEL[agentState];

  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    tab.classList.toggle('active', tab.dataset.game === activeGame);
  }

  const needsYou = agentState === 'needsYou';
  const gameArea = document.getElementById('game-area')!;
  const needsYouEl = document.getElementById('needs-you') as HTMLElement;
  gameArea.hidden = needsYou;
  needsYouEl.hidden = !needsYou;

  if (needsYou) {
    mounted?.deactivate(); // freeze the game while the approval surface is up
    document.getElementById('needs-you-message')!.textContent =
      needsYouMessage || 'Claude Code needs your input.';
  } else {
    renderGame(gameArea);
  }
}

function renderGame(container: HTMLElement): void {
  const instance = getInstance(activeGame);
  if (mounted && mounted !== instance) {
    mounted.deactivate();
  }
  if (!instance) {
    mounted = null;
    container.innerHTML = '<p class="placeholder">Trivia is unavailable.</p>';
    return;
  }
  if (instance.root.parentElement !== container) {
    container.innerHTML = '';
    container.appendChild(instance.root);
  }
  mounted = instance;
  instance.activate();
}

function pauseAll(): void {
  for (const instance of instances.values()) {
    instance.deactivate();
  }
}

window.addEventListener('keydown', (e) => {
  if (agentState === 'needsYou') {
    return;
  }
  const instance = instances.get(activeGame);
  if (instance?.handleKey(e)) {
    e.preventDefault();
  }
});

window.addEventListener('blur', pauseAll);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseAll();
  }
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type === 'state') {
    agentState = msg.state as AgentState;
    needsYouMessage = typeof msg.message === 'string' ? msg.message : '';
    update();
  } else if (msg?.type === 'scores') {
    bestScores = { ...bestScores, ...msg.scores };
    for (const [id, instance] of instances) {
      instance.setBest(bestScores[id] ?? 0);
    }
  } else if (msg?.type === 'trivia') {
    const trivia = instances.get('trivia');
    if (trivia instanceof TriviaGame && msg.question) {
      trivia.setQuestion(msg.question);
    }
  } else if (msg?.type === 'triviaAvailable' && msg.available === false) {
    triviaAvailable = false;
    instances.delete('trivia');
    const tab = document.querySelector<HTMLButtonElement>('.tab[data-game="trivia"]');
    if (tab) {
      tab.hidden = true;
    }
    if (activeGame === 'trivia') {
      activeGame = '2048';
      vscode.setState({ activeGame });
    }
    update();
  }
});

buildShell();
update();
vscode.postMessage({ type: 'ready' });
