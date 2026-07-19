import * as path from 'path';
import * as vscode from 'vscode';
import { installHooks, uninstallHooks } from './hooks';
import { HttpListener } from './listener';
import { PanelController, setPanelContext, StandbyViewProvider } from './panel';
import { AgentStateMachine, StateChange } from './state';
import { TriviaStore } from './trivia';

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Standby');
  const log = (line: string) => output.appendLine(`[${new Date().toISOString()}] ${line}`);

  const provider = new StandbyViewProvider(context.extensionUri);
  const machine = new AgentStateMachine();
  const trivia = new TriviaStore(context.globalState, log);
  const panel = new PanelController(provider, machine, context.globalState, trivia, log);

  // The view is gated behind this context key so hide() can remove it
  // regardless of where it's docked; start visible so it's discoverable.
  setPanelContext(true);

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

  const listener = new HttpListener((event, cwd, message) => {
    if (!cwdMatchesWorkspace(cwd)) {
      log(`ignored ${event}: cwd ${cwd} outside workspace`);
      return;
    }
    log(`event ${event}${message ? ` (${message})` : ''}`);
    machine.handle(event, message);
  }, log);

  const getPort = () =>
    vscode.workspace.getConfiguration('standby').get<number>('port', 48219);
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

    vscode.window.registerWebviewViewProvider(StandbyViewProvider.viewId, provider),

    vscode.commands.registerCommand('standby.showPanel', () => panel.reveal(true)),

    vscode.commands.registerCommand('standby.hidePanel', () => panel.hide()),

    vscode.commands.registerCommand('standby.installHooks', () => installHooks(context)),

    vscode.commands.registerCommand('standby.uninstallHooks', () => uninstallHooks())
  );
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

export function deactivate() {}
