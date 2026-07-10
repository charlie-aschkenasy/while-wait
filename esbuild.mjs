import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const extensionCtx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
});

const webviewCtx = await esbuild.context({
  entryPoints: ['webview/index.ts'],
  bundle: true,
  outfile: 'dist/webview/index.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
});

function copyStatic() {
  mkdirSync('dist/webview', { recursive: true });
  cpSync('webview/ui.css', 'dist/webview/ui.css');
}

if (watch) {
  copyStatic();
  await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
  console.log('watching...');
} else {
  copyStatic();
  await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
  await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
  console.log('build complete');
}
