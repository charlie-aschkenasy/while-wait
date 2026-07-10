import { GameHost, GameInstance } from './types';

export interface TriviaQuestion {
  id: string;
  prompt: string;
  options: string[];
  correct_index: number;
  sport: string;
  difficulty: number;
}

export class TriviaGame implements GameInstance {
  readonly root = document.createElement('div');

  private readonly streakEl = document.createElement('span');
  private readonly bestEl = document.createElement('span');
  private readonly card = document.createElement('div');

  private question: TriviaQuestion | undefined;
  private answered = false;
  private waiting = false;
  private streak = 0;
  private best: number;

  constructor(private readonly host: GameHost, best: number) {
    this.best = best;

    this.root.className = 'game';
    const header = document.createElement('div');
    header.className = 'game-header';
    this.streakEl.className = 'game-score';
    this.bestEl.className = 'game-best';
    header.append(this.streakEl, this.bestEl);

    this.card.className = 'trivia-card';
    this.root.append(header, this.card);
    this.updateHeader();
    this.showLoading();
  }

  activate(): void {
    if (!this.question && !this.waiting) {
      this.requestNext();
    }
  }

  deactivate(): void {
    // Turn-based: nothing to freeze.
  }

  setBest(value: number): void {
    if (value > this.best) {
      this.best = value;
      this.updateHeader();
    }
  }

  setQuestion(question: TriviaQuestion): void {
    this.waiting = false;
    this.question = question;
    this.answered = false;
    this.renderQuestion(question);
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.question) {
      return false;
    }
    if (this.answered && (e.key === ' ' || e.key === 'Enter')) {
      this.requestNext();
      return true;
    }
    if (!this.answered && e.key >= '1' && e.key <= String(this.question.options.length)) {
      this.answer(Number(e.key) - 1);
      return true;
    }
    return false;
  }

  private requestNext(): void {
    this.waiting = true;
    this.question = undefined;
    this.showLoading();
    this.host.requestTrivia();
  }

  private answer(index: number): void {
    if (!this.question || this.answered) {
      return;
    }
    this.answered = true;
    const correct = index === this.question.correct_index;
    if (correct) {
      this.streak += 1;
      if (this.streak > this.best) {
        this.best = this.streak;
        this.host.reportBest('trivia', this.best);
      }
    } else {
      this.streak = 0;
    }
    this.updateHeader();

    const buttons = this.card.querySelectorAll<HTMLButtonElement>('.trivia-option');
    buttons.forEach((button, i) => {
      button.disabled = true;
      if (i === this.question!.correct_index) {
        button.classList.add('correct');
      } else if (i === index) {
        button.classList.add('wrong');
      }
    });

    const next = document.createElement('button');
    next.className = 'primary-button trivia-next';
    next.textContent = 'Next question';
    next.addEventListener('click', () => this.requestNext());
    this.card.appendChild(next);
  }

  private renderQuestion(question: TriviaQuestion): void {
    this.card.innerHTML = '';

    const badges = document.createElement('div');
    badges.className = 'trivia-badges';
    const sport = document.createElement('span');
    sport.className = 'trivia-badge';
    sport.textContent = question.sport;
    const difficulty = document.createElement('span');
    difficulty.className = 'trivia-badge';
    difficulty.textContent = '★'.repeat(question.difficulty);
    difficulty.title = `difficulty ${question.difficulty}/5`;
    badges.append(sport, difficulty);

    const prompt = document.createElement('p');
    prompt.className = 'trivia-prompt';
    prompt.textContent = question.prompt;

    const options = document.createElement('div');
    options.className = 'trivia-options';
    question.options.forEach((text, i) => {
      const button = document.createElement('button');
      button.className = 'trivia-option';
      button.textContent = text;
      button.addEventListener('click', () => this.answer(i));
      options.appendChild(button);
    });

    this.card.append(badges, prompt, options);
  }

  private showLoading(): void {
    this.card.innerHTML = '<p class="placeholder">loading…</p>';
  }

  private updateHeader(): void {
    this.streakEl.textContent = `streak ${this.streak}`;
    this.bestEl.textContent = `best ${this.best}`;
  }
}
