import * as http from 'http';
import * as vscode from 'vscode';
import { HOOK_EVENTS, HookEvent } from './state';

const MAX_BODY_BYTES = 64 * 1024;

export type EventHandler = (event: HookEvent, cwd: string, message?: string) => void;

/**
 * Localhost-only HTTP server the Claude Code hooks post to.
 * Accepts the raw hook stdin JSON: { hook_event_name, cwd, message?, ... }.
 */
export class HttpListener implements vscode.Disposable {
  private server: http.Server | undefined;
  private warnedPortInUse = false;

  constructor(
    private readonly onEvent: EventHandler,
    private readonly log: (line: string) => void
  ) {}

  start(port: number): void {
    this.stop();

    const server = http.createServer((req, res) => this.route(req, res));
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Another window owns the port; this instance stays dormant (v1 behavior).
        if (!this.warnedPortInUse) {
          this.warnedPortInUse = true;
          vscode.window.showWarningMessage(
            `Standby: port ${port} is already in use (another Cursor window?). ` +
              'Standby is dormant in this window.'
          );
        }
        this.log(`port ${port} in use; listener dormant`);
      } else {
        this.log(`listener error: ${err.message}`);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      this.log(`listening on 127.0.0.1:${port}`);
    });
    this.server = server;
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
  }

  dispose(): void {
    this.stop();
  }

  private route(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'POST' || req.url !== '/event') {
      res.statusCode = 404;
      res.end();
      return;
    }

    let body = '';
    let overflow = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        overflow = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (overflow) {
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        res.statusCode = 400;
        res.end();
        return;
      }

      const p = payload as Record<string, unknown>;
      const event = p.hook_event_name;
      const cwd = p.cwd;
      if (
        typeof event !== 'string' ||
        !HOOK_EVENTS.has(event) ||
        typeof cwd !== 'string'
      ) {
        res.statusCode = 400;
        res.end();
        return;
      }

      // Respond before processing so the hook's curl returns instantly.
      res.statusCode = 204;
      res.end();

      const message = typeof p.message === 'string' ? p.message : undefined;
      this.onEvent(event as HookEvent, cwd, message);
    });
  }
}
