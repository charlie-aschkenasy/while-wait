import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { EventRecord } from './extension';
import { readInstalledHooks } from './hooks';
import type { ListenerStatus } from './listener';
import * as registry from './registry';

export interface DiagnosticsDeps {
  listenerStatus: () => ListenerStatus;
  lastReceived: () => EventRecord | undefined;
  lastAccepted: () => EventRecord | undefined;
}

const HOOK_EVENTS = [
  'UserPromptSubmit',
  'Stop',
  'Notification',
  'PostToolUse',
  'SessionEnd',
];

function ago(at: number | undefined): string {
  if (at === undefined) {
    return 'never';
  }
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/**
 * Assembles a copy-pasteable status report and shows it as an untitled document
 * plus a one-line summary. Everything here is a response to an explicit user
 * command (not an unsolicited nudge), so the info message is compatible with the
 * no-toasts guarantee. Never surfaces Supabase secret values — presence only.
 */
export async function showDiagnostics(
  context: vscode.ExtensionContext,
  deps: DiagnosticsDeps
): Promise<void> {
  const version = (context.extension.packageJSON as { version?: string }).version ?? 'unknown';
  const config = vscode.workspace.getConfiguration('standby');
  const configuredPort = config.get<number>('port', 0);

  const scriptPath = context.asAbsolutePath(path.join('hooks', 'standby-hook.sh'));
  let scriptExists = false;
  let scriptExecutable = false;
  try {
    const stat = fs.statSync(scriptPath);
    scriptExists = true;
    scriptExecutable = (stat.mode & 0o111) !== 0;
  } catch {
    // scriptExists stays false
  }

  const status = deps.listenerStatus();
  const hooks = readInstalledHooks();
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const received = deps.lastReceived();
  const accepted = deps.lastAccepted();

  const supabaseUrlSet = config.get<string>('supabase.url', '').trim() !== '';
  const supabaseKeySet = config.get<string>('supabase.key', '').trim() !== '';

  // Registry (multi-window). readSnapshot never throws.
  let registryLines: string[];
  try {
    const entries = registry.readSnapshot();
    registryLines =
      entries.length === 0
        ? ['  (no entries — this window may be in fixed-port mode or not yet listening)']
        : entries.map(
            (e) => `  pid ${e.pid} → port ${e.port}  folders: ${e.folders.join(', ') || '(none)'}`
          );
  } catch (err) {
    registryLines = [`  (could not read registry: ${(err as Error).message})`];
  }

  // --- Mismatch detection (1c-6) ---
  const resolvedThisScript = path.resolve(scriptPath);
  const installedScriptsResolved = hooks.scriptPaths.map((p) => path.resolve(p));
  const scriptMismatch =
    hooks.installed && installedScriptsResolved.some((p) => p !== resolvedThisScript);
  // In auto mode (configuredPort === 0) a port-value difference is expected/benign.
  const portMismatch =
    hooks.installed &&
    configuredPort !== 0 &&
    hooks.ports.some((p) => p !== configuredPort);

  const mode = configuredPort === 0 ? 'auto (per-window ephemeral + registry)' : `fixed (${configuredPort})`;

  const lines = [
    `Standby diagnostics`,
    `===================`,
    ``,
    `Extension version: ${version}`,
    `Hook script (this build): ${scriptPath}`,
    `  exists: ${scriptExists}   executable: ${scriptExecutable}`,
    ``,
    `Port mode: ${mode}`,
    `Listener: ${status.status}` +
      (status.boundPort !== undefined ? ` on ${status.boundPort}` : '') +
      (status.detail ? ` — ${status.detail}` : ''),
    status.status === 'dormant'
      ? `  (another window won the fixed port; only one window can bind a fixed port)`
      : ``,
    ``,
    `Hooks installed: ${hooks.installed}`,
    `  settings.json: ${hooks.settingsPath} (exists: ${hooks.exists})`,
    hooks.parseError ? `  PARSE ERROR: ${hooks.parseError}` : ``,
    ...HOOK_EVENTS.map((e) => `    ${hooks.perEvent[e] ? '✓' : '✗'} ${e}`),
    hooks.scriptPaths.length ? `  installed script path(s): ${hooks.scriptPaths.join(', ')}` : ``,
    hooks.ports.length ? `  installed fallback port(s): ${hooks.ports.join(', ')}` : ``,
    scriptMismatch
      ? `  ⚠ installed hook path differs from this build — re-install hooks`
      : ``,
    portMismatch
      ? `  ⚠ installed hook port differs from standby.port (${configuredPort}) — re-install hooks`
      : ``,
    ``,
    `Workspace folders (the routing basis):`,
    ...(folders.length ? folders.map((f) => `  ${f}`) : ['  (none)']),
    ``,
    `Last event received (any):    ${received ? `${received.event} from ${received.cwd} (${ago(received.at)})` : 'never'}`,
    `Last event accepted (in ws):  ${accepted ? `${accepted.event} from ${accepted.cwd} (${ago(accepted.at)})` : 'never'}`,
    ``,
    `Registry (~/.standby/ports.json):`,
    ...registryLines,
    ``,
    `Trivia source: bundled bank always available; Supabase override — url set: ${supabaseUrlSet}, key set: ${supabaseKeySet}`,
    ``,
  ];

  const content = lines.filter((l) => l !== undefined).join('\n');
  const doc = await vscode.workspace.openTextDocument({ content });
  await vscode.window.showTextDocument(doc, { preview: false });

  // One-line summary + a fix action when something is actionable.
  const restartNote = 'then restart any running Claude Code session';
  if (!hooks.installed) {
    const choice = await vscode.window.showInformationMessage(
      'Standby: hooks are not installed. Install them, then restart Claude Code.',
      'Install hooks'
    );
    if (choice === 'Install hooks') {
      await vscode.commands.executeCommand('standby.installHooks');
    }
  } else if (scriptMismatch || portMismatch) {
    const choice = await vscode.window.showInformationMessage(
      `Standby: the installed hooks don't match this build — re-install hooks, ${restartNote}.`,
      'Re-install hooks'
    );
    if (choice === 'Re-install hooks') {
      await vscode.commands.executeCommand('standby.installHooks');
    }
  } else {
    vscode.window.showInformationMessage(
      `Standby: listener ${status.status}` +
        (status.boundPort !== undefined ? ` on ${status.boundPort}` : '') +
        `, hooks installed. Report opened in a new tab.`
    );
  }
}
