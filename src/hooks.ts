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

  const port = vscode.workspace.getConfiguration('standby').get<number>('port', 48219);
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
    `Standby hooks installed into ~/.claude/settings.json.${detail} ` +
      'Restart any running Claude Code session to pick them up.',
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
