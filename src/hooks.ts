import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const HOOK_EVENT_NAMES = [
  'UserPromptSubmit',
  'Stop',
  'Notification',
  'PostToolUse',
  'SessionEnd',
] as const;

const MARKER = 'standby-hook.sh';

interface HookCommand {
  type: 'command';
  command: string;
  timeout?: number;
}

interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}

/**
 * Merges the five Standby hook entries into ~/.claude/settings.json.
 * Idempotent: re-running updates our entries in place (path/port changes)
 * and never touches hooks we didn't add. Backs the file up first.
 */
export async function installHooks(context: vscode.ExtensionContext): Promise<void> {
  const scriptPath = context.asAbsolutePath(path.join('hooks', 'standby-hook.sh'));
  try {
    fs.chmodSync(scriptPath, 0o755);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Standby: hook script not found at ${scriptPath} (${(err as Error).message})`
    );
    return;
  }

  const port = vscode.workspace.getConfiguration('standby').get<number>('port', 0);
  const command = `"${scriptPath}" ${port}`;

  const settingsDir = path.join(os.homedir(), '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');

  let settings: Record<string, unknown> = {};
  let backupPath: string | undefined;
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    try {
      settings = JSON.parse(raw);
    } catch {
      vscode.window.showErrorMessage(
        `Standby: ${settingsPath} is not valid JSON — fix it (or install the hooks manually) and retry. Nothing was changed.`
      );
      await showManualJson(command);
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${settingsPath}.standby-backup-${stamp}`;
    fs.copyFileSync(settingsPath, backupPath);
  } else {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  const hooks = (settings.hooks ??= {}) as Record<string, HookGroup[]>;
  for (const event of HOOK_EVENT_NAMES) {
    const groups = (hooks[event] ??= []);
    const existing = groups
      .flatMap((g) => g.hooks ?? [])
      .find((h) => typeof h.command === 'string' && h.command.includes(MARKER));
    if (existing) {
      existing.command = command; // refresh path/port on re-install
      continue;
    }
    const group: HookGroup =
      event === 'PostToolUse'
        ? { matcher: '*', hooks: [{ type: 'command', command, timeout: 5 }] }
        : { hooks: [{ type: 'command', command, timeout: 5 }] };
    groups.push(group);
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  const detail = backupPath ? ` Backup: ${path.basename(backupPath)}.` : '';
  const choice = await vscode.window.showInformationMessage(
    'Restart any running Claude Code session to pick up the Standby hooks. ' +
      `Installed into ~/.claude/settings.json.${detail}`,
    'Show hook JSON'
  );
  if (choice === 'Show hook JSON') {
    await showManualJson(command);
  }
}

/**
 * Removes every Standby hook entry from ~/.claude/settings.json (identified by
 * the standby-hook.sh marker), leaving all other hooks untouched. Backs up first.
 */
export async function uninstallHooks(): Promise<void> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    vscode.window.showInformationMessage('Standby: no ~/.claude/settings.json — nothing to remove.');
    return;
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    vscode.window.showErrorMessage(
      `Standby: ${settingsPath} is not valid JSON — remove the entries referencing ${MARKER} by hand.`
    );
    return;
  }

  const hooks = settings.hooks as Record<string, HookGroup[]> | undefined;
  if (!hooks) {
    vscode.window.showInformationMessage('Standby: no hooks configured — nothing to remove.');
    return;
  }

  let removed = 0;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) {
      continue;
    }
    for (const group of groups) {
      const before = group.hooks?.length ?? 0;
      group.hooks = (group.hooks ?? []).filter(
        (h) => !(typeof h.command === 'string' && h.command.includes(MARKER))
      );
      removed += before - group.hooks.length;
    }
    hooks[event] = groups.filter((g) => (g.hooks?.length ?? 0) > 0);
    if (hooks[event].length === 0) {
      delete hooks[event];
    }
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }

  if (removed === 0) {
    vscode.window.showInformationMessage('Standby: no Standby hooks found — nothing to remove.');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(settingsPath, `${settingsPath}.standby-backup-${stamp}`);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  vscode.window.showInformationMessage(
    `Standby: removed ${removed} hook entr${removed === 1 ? 'y' : 'ies'} from ~/.claude/settings.json.`
  );
}

export interface InstalledHooks {
  settingsPath: string;
  exists: boolean;
  parseError?: string;
  installed: boolean; // all five events have a Standby hook
  perEvent: Record<string, boolean>;
  scriptPaths: string[]; // distinct script paths found in Standby hook commands
  ports: number[]; // distinct fallback ports parsed from those commands
}

/**
 * Introspects ~/.claude/settings.json for the installed Standby hooks. Never
 * throws — a missing or unparseable file returns a well-formed "not installed"
 * result. Single source of truth for the diagnostics command and mismatch
 * detection. Does not modify anything.
 */
export function readInstalledHooks(): InstalledHooks {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const perEvent: Record<string, boolean> = {};
  for (const event of HOOK_EVENT_NAMES) {
    perEvent[event] = false;
  }
  const result: InstalledHooks = {
    settingsPath,
    exists: false,
    installed: false,
    perEvent,
    scriptPaths: [],
    ports: [],
  };

  if (!fs.existsSync(settingsPath)) {
    return result;
  }
  result.exists = true;

  let settings: { hooks?: Record<string, HookGroup[]> };
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    result.parseError = (err as Error).message;
    return result;
  }

  const hooks = settings.hooks ?? {};
  const scriptPaths = new Set<string>();
  const ports = new Set<number>();

  for (const event of HOOK_EVENT_NAMES) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    const match = groups
      .flatMap((g) => g.hooks ?? [])
      .find((h) => typeof h.command === 'string' && h.command.includes(MARKER));
    if (match) {
      perEvent[event] = true;
      // The installed command shape is: "<abs script path>" <port>
      const cmd = match.command;
      const open = cmd.indexOf('"');
      const close = cmd.indexOf('"', open + 1);
      if (open !== -1 && close !== -1) {
        scriptPaths.add(cmd.slice(open + 1, close));
        const rest = cmd.slice(close + 1).trim();
        if (rest !== '') {
          const port = Number(rest);
          if (!Number.isNaN(port)) {
            ports.add(port);
          }
        }
      }
    }
  }

  result.scriptPaths = [...scriptPaths];
  result.ports = [...ports];
  result.installed = HOOK_EVENT_NAMES.every((e) => perEvent[e]);
  return result;
}

/** Opens the hook entries as a JSON snippet for manual installation. */
async function showManualJson(command: string): Promise<void> {
  const hooks: Record<string, HookGroup[]> = {};
  for (const event of HOOK_EVENT_NAMES) {
    hooks[event] =
      event === 'PostToolUse'
        ? [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 5 }] }]
        : [{ hooks: [{ type: 'command', command, timeout: 5 }] }];
  }
  const doc = await vscode.workspace.openTextDocument({
    language: 'json',
    content:
      '// Merge into the "hooks" object of ~/.claude/settings.json\n' +
      JSON.stringify({ hooks }, null, 2) +
      '\n',
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}
