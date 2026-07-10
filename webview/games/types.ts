export interface GameHost {
  /** Called when a game beats its best score; the extension persists it. */
  reportBest(game: string, value: number): void;
}

export interface GameInstance {
  readonly root: HTMLElement;
  /** Tab selected / panel visible again. */
  activate(): void;
  /** Tab left or panel hidden — must freeze the game, never kill the player. */
  deactivate(): void;
  /** @returns true if the key was consumed. */
  handleKey(e: KeyboardEvent): boolean;
  setBest(value: number): void;
}

/** Resolve a `--vscode-*` theme variable to a concrete color for canvas use. */
export function themeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}
