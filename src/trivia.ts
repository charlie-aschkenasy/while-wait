import * as vscode from 'vscode';

export interface TriviaQuestion {
  id: string;
  prompt: string;
  options: string[];
  correct_index: number;
  sport: string;
  difficulty: number;
}

interface TriviaCache {
  fetchedAt: number;
  questions: TriviaQuestion[];
}

const CACHE_KEY = 'standby.triviaCache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SELECT = 'id,prompt,options,correct_index,sport,difficulty';

/**
 * Fetches the question set once (they're tiny), caches it in globalState with
 * a TTL, and serves questions from a shuffled queue. A failed fetch falls back
 * to a stale cache; with neither, trivia reports itself unavailable.
 */
export class TriviaStore {
  private questions: TriviaQuestion[] = [];
  private queue: TriviaQuestion[] = [];
  private loading: Promise<boolean> | undefined;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly log: (line: string) => void
  ) {}

  /** Resolves true when questions are available (memory, fresh fetch, or stale cache). */
  ensureLoaded(): Promise<boolean> {
    if (this.questions.length > 0) {
      return Promise.resolve(true);
    }
    if (!this.loading) {
      this.loading = this.load().then((ok) => {
        if (!ok) {
          this.loading = undefined; // allow a retry (e.g. after settings change)
        }
        return ok;
      });
    }
    return this.loading;
  }

  next(): TriviaQuestion | undefined {
    if (this.questions.length === 0) {
      return undefined;
    }
    if (this.queue.length === 0) {
      this.queue = shuffle([...this.questions]);
    }
    return this.queue.pop();
  }

  /** Call when the Supabase settings change so the next request refetches. */
  invalidate(): void {
    this.questions = [];
    this.queue = [];
    this.loading = undefined;
  }

  private async load(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('standby');
    const url = config.get<string>('supabase.url', '').trim().replace(/\/+$/, '');
    const key = config.get<string>('supabase.key', '').trim();
    const cached = this.globalState.get<TriviaCache>(CACHE_KEY);

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.questions.length > 0) {
      this.questions = cached.questions;
      this.log(`trivia: using cached questions (${cached.questions.length})`);
      return true;
    }

    if (url && key) {
      try {
        const res = await fetch(
          `${url}/rest/v1/questions?select=${SELECT}&verified=eq.true`,
          { headers: { apikey: key } }
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const rows = (await res.json()) as unknown;
        const questions = Array.isArray(rows) ? rows.filter(isValidQuestion) : [];
        if (questions.length > 0) {
          this.questions = questions;
          await this.globalState.update(CACHE_KEY, {
            fetchedAt: Date.now(),
            questions,
          } satisfies TriviaCache);
          this.log(`trivia: fetched ${questions.length} questions`);
          return true;
        }
        this.log('trivia: fetch returned no usable questions');
      } catch (err) {
        // Never log the key.
        this.log(`trivia: fetch failed (${(err as Error).message})`);
      }
    } else {
      this.log('trivia: supabase url/key not configured');
    }

    if (cached && cached.questions.length > 0) {
      this.questions = cached.questions;
      this.log(`trivia: falling back to stale cache (${cached.questions.length})`);
      return true;
    }
    return false;
  }
}

function isValidQuestion(row: unknown): row is TriviaQuestion {
  const q = row as TriviaQuestion;
  return (
    typeof q?.prompt === 'string' &&
    Array.isArray(q.options) &&
    q.options.length >= 2 &&
    q.options.every((o) => typeof o === 'string') &&
    typeof q.correct_index === 'number' &&
    q.correct_index >= 0 &&
    q.correct_index < q.options.length
  );
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
