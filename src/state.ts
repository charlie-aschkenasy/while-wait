import * as vscode from 'vscode';

export type AgentState = 'working' | 'done' | 'needsYou';

export type HookEvent =
  | 'UserPromptSubmit'
  | 'Stop'
  | 'Notification'
  | 'PostToolUse'
  | 'SessionEnd';

export const HOOK_EVENTS: ReadonlySet<string> = new Set([
  'UserPromptSubmit',
  'Stop',
  'Notification',
  'PostToolUse',
  'SessionEnd',
]);

/** A `Stop` only becomes `done` if no working-event follows within this window,
 *  so a rapid Stop → UserPromptSubmit doesn't flash the panel. */
const STOP_SETTLE_MS = 300;

/** `working` with no events for this long means the session crashed or the
 *  terminal was killed — decay to `done` so the panel never sticks around. */
const STUCK_WORKING_MS = 30 * 60 * 1000;

export interface StateChange {
  state: AgentState;
  /** Notification text, present only for needsYou. */
  message?: string;
  since: number;
}

export class AgentStateMachine implements vscode.Disposable {
  private state: AgentState = 'done';
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private readonly emitter = new vscode.EventEmitter<StateChange>();

  readonly onDidChange = this.emitter.event;

  get current(): AgentState {
    return this.state;
  }

  handle(event: HookEvent, message?: string): void {
    switch (event) {
      case 'UserPromptSubmit':
      case 'PostToolUse':
        // PostToolUse also clears needsYou: the approval was granted and the tool ran.
        this.cancelStopTimer();
        this.set('working');
        break;
      case 'Notification':
        this.cancelStopTimer();
        this.set('needsYou', message);
        break;
      case 'Stop':
        this.cancelStopTimer();
        this.stopTimer = setTimeout(() => {
          this.stopTimer = undefined;
          this.set('done');
        }, STOP_SETTLE_MS);
        break;
      case 'SessionEnd':
        // Immediate: the session is gone, never leave a stuck panel.
        this.cancelStopTimer();
        this.set('done');
        break;
    }
  }

  private set(state: AgentState, message?: string): void {
    this.resetWatchdog(state);
    if (state === this.state && state !== 'needsYou') {
      return;
    }
    this.state = state;
    this.emitter.fire({ state, message, since: Date.now() });
  }

  private resetWatchdog(state: AgentState): void {
    if (this.watchdog !== undefined) {
      clearTimeout(this.watchdog);
      this.watchdog = undefined;
    }
    if (state === 'working') {
      this.watchdog = setTimeout(() => {
        this.watchdog = undefined;
        this.set('done');
      }, STUCK_WORKING_MS);
    }
  }

  private cancelStopTimer(): void {
    if (this.stopTimer !== undefined) {
      clearTimeout(this.stopTimer);
      this.stopTimer = undefined;
    }
  }

  dispose(): void {
    this.cancelStopTimer();
    if (this.watchdog !== undefined) {
      clearTimeout(this.watchdog);
      this.watchdog = undefined;
    }
    this.emitter.dispose();
  }
}
