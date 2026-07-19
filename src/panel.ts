import * as vscode from 'vscode';
import { AgentStateMachine, StateChange } from './state';
import { TriviaStore } from './trivia';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'focusTerminal' }
  | { type: 'score'; game: string; value: number }
  | { type: 'triviaNext' };

const BEST_SCORES_KEY = 'standby.bestScores';

/** The view's `when` clause in package.json — flipping this context key is the
 *  one hide mechanism that works no matter where the user docked the view. */
const PANEL_CONTEXT_KEY = 'standby.panelVisible';

export function setPanelContext(visible: boolean): Thenable<unknown> {
  return vscode.commands.executeCommand('setContext', PANEL_CONTEXT_KEY, visible);
}

export class StandbyViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'standby.panel';

  private view: vscode.WebviewView | undefined;
  private readonly visibilityEmitter = new vscode.EventEmitter<boolean>();
  private readonly messageEmitter = new vscode.EventEmitter<WebviewMessage>();

  /** Fires with the view's visibility whenever it changes (or the view is disposed). */
  readonly onDidChangeVisibility = this.visibilityEmitter.event;
  readonly onDidReceiveMessage = this.messageEmitter.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.onDidChangeVisibility(() => {
      this.visibilityEmitter.fire(webviewView.visible);
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
        this.visibilityEmitter.fire(false);
      }
    });
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      this.messageEmitter.fire(msg);
    });

    this.visibilityEmitter.fire(webviewView.visible);
  }

  postMessage(message: unknown): void {
    this.view?.webview.postMessage(message);
  }

  /** Reveal an already-resolved view without stealing focus. */
  show(): void {
    this.view?.show(true);
  }

  get resolved(): boolean {
    return this.view !== undefined;
  }

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'ui.css')
    );
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Standby</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/**
 * Drives panel visibility from agent state:
 *   working  → reveal (never stealing focus)
 *   done     → hide immediately (the feel-critical path)
 *   needsYou → reveal + the webview swaps to the approval surface
 * If the user closes the panel during a wait, stay hidden until the next
 * `working` transition.
 */
export class PanelController implements vscode.Disposable {
  private suppressed = false;
  private hiding = false;
  private pendingReveal = false;
  private lastChange: StateChange = { state: 'done', since: Date.now() };
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly provider: StandbyViewProvider,
    machine: AgentStateMachine,
    private readonly globalState: vscode.Memento,
    private readonly trivia: TriviaStore,
    private readonly log: (line: string) => void
  ) {
    this.disposables.push(
      machine.onDidChange((change) => this.onState(change)),

      // Never pop the panel while the window is in the background; catch up
      // when the user comes back if the wait is still on.
      vscode.window.onDidChangeWindowState((ws) => {
        if (ws.focused && this.pendingReveal) {
          this.pendingReveal = false;
          if (this.lastChange.state !== 'done' && !this.suppressed) {
            this.log('window refocused mid-wait — revealing deferred panel');
            void this.reveal();
          }
        }
      }),

      provider.onDidChangeVisibility((visible) => {
        if (!visible && !this.hiding && this.lastChange.state !== 'done') {
          // The user closed the panel (or navigated away) mid-wait: respect it.
          this.suppressed = true;
          this.log('panel closed by user — suppressing until next working transition');
        }
      }),

      provider.onDidReceiveMessage(async (msg) => {
        this.log(`webview message: ${msg.type}`);
        if (msg.type === 'ready') {
          this.provider.postMessage({
            type: 'scores',
            scores: this.globalState.get<Record<string, number>>(BEST_SCORES_KEY, {}),
          });
          this.sendState();
        } else if (msg.type === 'triviaNext') {
          const available = await this.trivia.ensureLoaded();
          this.provider.postMessage(
            available
              ? { type: 'trivia', question: this.trivia.next() }
              : { type: 'triviaAvailable', available: false }
          );
        } else if (msg.type === 'score') {
          const scores = this.globalState.get<Record<string, number>>(BEST_SCORES_KEY, {});
          if (msg.value > (scores[msg.game] ?? 0)) {
            await this.globalState.update(BEST_SCORES_KEY, {
              ...scores,
              [msg.game]: msg.value,
            });
          }
        } else if (msg.type === 'focusTerminal') {
          try {
            await vscode.commands.executeCommand('workbench.action.terminal.focus');
          } catch (err) {
            this.log(`focusTerminal failed: ${(err as Error).message}`);
          }
        }
      })
    );
  }

  async reveal(userInitiated = false): Promise<void> {
    if (userInitiated) {
      this.suppressed = false;
    } else if (!vscode.window.state.focused) {
      this.pendingReveal = true;
      this.log('reveal deferred: window not focused');
      return;
    }
    this.pendingReveal = false;
    await setPanelContext(true);
    if (this.provider.resolved) {
      this.provider.show();
      return;
    }
    // The view may need a beat to re-register after the context flip.
    await delay(50);
    // Forcing an unresolved view to resolve steals focus — hand it straight
    // back to the editor.
    await vscode.commands.executeCommand('standby.panel.focus');
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  }

  async hide(): Promise<void> {
    if (!this.provider.visible) {
      this.log('hide: panel not visible, nothing to do');
      return;
    }
    this.hiding = true;
    const started = Date.now();
    try {
      await setPanelContext(false);
      this.log(`hide: view hidden via context key in ${Date.now() - started}ms`);
    } finally {
      // Swallow the visibility events our own hide produced.
      setTimeout(() => (this.hiding = false), 200);
    }
  }

  private async onState(change: StateChange): Promise<void> {
    const previous = this.lastChange.state;
    this.lastChange = change;
    this.sendState();

    switch (change.state) {
      case 'working':
        if (previous !== 'working') {
          this.suppressed = false;
        }
        if (!this.suppressed) {
          await this.reveal();
        }
        break;
      case 'needsYou':
        // Actionable: reveal even if the user closed the panel earlier.
        await this.reveal();
        break;
      case 'done':
        this.pendingReveal = false;
        await this.hide();
        break;
    }
  }

  private sendState(): void {
    this.provider.postMessage({
      type: 'state',
      state: this.lastChange.state,
      message: this.lastChange.message,
    });
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
