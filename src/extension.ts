import * as path from 'path';
import * as vscode from 'vscode';
import { showDiagnostics } from './diagnostics';
import { installHooks, uninstallHooks } from './hooks';
import { HttpListener } from './listener';
import { PanelController, StandbyViewProvider } from './panel';
import * as registry from './registry';
import { AgentStateMachine, HookEvent, StateChange } from './state';
import { TriviaStore } from './trivia';

export interface EventRecord {
  event: HookEvent;
  cwd: string;
  at: number;
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Standby');
  const log = (line: string) => output.appendLine(`[${new Date().toISOString()}] ${line}`);

  // Self-heal the registry: drop entries for windows that crashed without cleanup.
  try {
    registry.pruneStartup();
  } catch (err) {
    log(`registry pruneStartup failed: ${(err as Error).message}`);
  }
  let boundPort = 0;

  // Last hook event seen (for diagnostics). lastReceived = anything arriving at
  // all; lastAccepted = passed the workspace filter. In-memory only.
  let lastReceived: EventRecord | undefined;
  let lastAccepted: EventRecord | undefined;

  const provider = new StandbyViewProvider(context.extensionUri);
  const machine = new AgentStateMachine();
  const trivia = new TriviaStore(context, log);
  const panel = new PanelController(provider, machine, context.globalState, trivia, log);

  // Status bar: the first consumer of the lifecycle (M1). Hidden until the
  // first real event so a fresh window isn't cluttered with "✓ done".
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.name = 'Standby';
  statusItem.command = 'standby.showPanel';

  machine.onDidChange((change: StateChange) => {
    log(`state → ${change.state}${change.message ? ` (${change.message})` : ''}`);
    renderStatus(statusItem, change);
    statusItem.show();
  });

  const registerWindow = () => {
    if (boundPort <= 0) {
      return; // not listening yet; nothing to register
    }
    try {
      registry.register({
        pid: process.pid,
        port: boundPort,
        folders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      });
    } catch (err) {
      log(`registry register failed: ${(err as Error).message}`);
    }
  };

  const listener = new HttpListener(
    (event, cwd, message) => {
      lastReceived = { event, cwd, at: Date.now() };
      // Secondary safety filter: the primary routing is by port (the hook picks
      // this window's ephemeral port from the registry by cwd), but in legacy
      // fixed-port mode this is the primary filter — keep it in both modes.
      if (!cwdMatchesWorkspace(cwd)) {
        log(`ignored ${event}: cwd ${cwd} outside workspace`);
        return;
      }
      lastAccepted = { event, cwd, at: Date.now() };
      log(`event ${event}${message ? ` (${message})` : ''}`);
      machine.handle(event, message);
    },
    log,
    (port) => {
      boundPort = port;
      registerWindow();
    }
  );

  const getPort = () =>
    vscode.workspace.getConfiguration('standby').get<number>('port', 0);
  listener.start(getPort());

  context.subscriptions.push(
    output,
    machine,
    panel,
    statusItem,
    listener,

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('standby.port')) {
        log(`port setting changed → restarting listener on ${getPort()}`);
        listener.start(getPort());
      }
      if (e.affectsConfiguration('standby.supabase')) {
        log('supabase settings changed → invalidating trivia store');
        trivia.invalidate();
      }
    }),

    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // Keep the registry's folder list current so the hook routes correctly.
      registerWindow();
    }),

    vscode.window.registerWebviewViewProvider(StandbyViewProvider.viewId, provider, {
      // Keep the webview alive while hidden so reveal is instant and games
      // resume where they were paused instead of reloading from scratch.
      webviewOptions: { retainContextWhenHidden: true },
    }),

    vscode.commands.registerCommand('standby.showPanel', () => panel.reveal(true)),

    vscode.commands.registerCommand('standby.hidePanel', () => panel.hide()),

    vscode.commands.registerCommand('standby.installHooks', () => installHooks(context)),

    vscode.commands.registerCommand('standby.uninstallHooks', () => uninstallHooks()),

    vscode.commands.registerCommand('standby.showDiagnostics', () =>
      showDiagnostics(context, {
        listenerStatus: () => listener.getStatus(),
        lastReceived: () => lastReceived,
        lastAccepted: () => lastAccepted,
      })
    )
  );

  maybeShowFirstRunNotice(context, log);
}

/**
 * One-time, once-ever-per-profile notice pointing at the required secondary-
 * sidebar placement (otherwise the panel is "installed but invisible"). This is
 * the single sanctioned exception to the no-toasts guarantee: it fires exactly
 * once, is never state-driven, and can never recur (a globalState flag is set
 * immediately). 'Show me' reveals the panel WITHOUT stealing editor focus
 * (panel.reveal hands focus back to the editor).
 */
function maybeShowFirstRunNotice(
  context: vscode.ExtensionContext,
  log: (line: string) => void
): void {
  if (context.globalState.get<boolean>('standby.firstRunNoticeShown', false)) {
    return;
  }
  // Set the flag first so it can never recur, even if the message is dismissed.
  void context.globalState.update('standby.firstRunNoticeShown', true);

  void vscode.window
    .showInformationMessage(
      'Standby lives in the secondary sidebar — drag the Standby view there ' +
        '(and keep it alone) so hide works.',
      'Show me',
      'Open README'
    )
    .then((choice) => {
      if (choice === 'Show me') {
        void vscode.commands.executeCommand('standby.showPanel');
      } else if (choice === 'Open README') {
        const readme = vscode.Uri.joinPath(context.extensionUri, 'README.md');
        void vscode.commands.executeCommand('markdown.showPreview', readme).then(undefined, (err) => {
          log(`first-run README preview failed: ${(err as Error).message}`);
        });
      }
    });
}

function renderStatus(item: vscode.StatusBarItem, change: StateChange): void {
  switch (change.state) {
    case 'working':
      item.text = '⋯ working';
      item.tooltip = 'Standby: Claude Code is working';
      item.backgroundColor = undefined;
      break;
    case 'done':
      item.text = '✓ done';
      item.tooltip = 'Standby: Claude Code is done';
      item.backgroundColor = undefined;
      break;
    case 'needsYou':
      item.text = '● needs you';
      item.tooltip = `Standby: ${change.message ?? 'Claude Code needs your input'}`;
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      break;
  }
}

function cwdMatchesWorkspace(cwd: string): boolean {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return false;
  }
  const norm = path.resolve(cwd);
  return folders.some((folder) => {
    const root = folder.uri.fsPath;
    return norm === root || norm.startsWith(root + path.sep);
  });
}

export function deactivate() {
  // Remove this window's registry entry on a clean close. Synchronous and
  // guarded: deactivate has a limited shutdown window and must not throw.
  try {
    registry.unregister(process.pid);
  } catch {
    // A crash leaves the entry behind; other windows prune it by pid-liveness.
  }
}
