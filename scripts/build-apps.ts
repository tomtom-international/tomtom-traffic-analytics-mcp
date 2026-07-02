/**
 * Build script for MCP Apps - parallel builds with vite-plugin-singlefile
 *
 * Concurrency is capped to avoid OOM when building all apps at once.
 *
 * Uses node:path/node:url helpers throughout so this works on Windows
 * (win32) as well as POSIX platforms.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const CATEGORY = 'traffic-analytics';
const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const APPS_DIR = path.join(ROOT_DIR, 'src', 'apps');
const DIST_DIR = path.join(ROOT_DIR, 'dist', 'apps');
const SHARED_DIR = path.join(APPS_DIR, 'shared');

interface AppEntry {
  category: string;
  name: string;
  id: string;
  htmlPath: string;
  appDir: string;
}

function discoverApps(): AppEntry[] {
  const apps: AppEntry[] = [];
  const categoryDir = path.join(APPS_DIR, CATEGORY);
  if (!fs.existsSync(categoryDir)) return apps;
  for (const appName of fs.readdirSync(categoryDir)) {
    const appDir = path.join(categoryDir, appName);
    if (!fs.statSync(appDir).isDirectory()) continue;
    const htmlPath = path.join(appDir, 'app.html');
    if (!fs.existsSync(htmlPath)) continue;
    apps.push({ category: CATEGORY, name: appName, id: path.join(CATEGORY, appName), htmlPath, appDir });
  }
  return apps;
}

async function buildApp(app: AppEntry): Promise<{ app: AppEntry; success: boolean; error?: string }> {
  try {
    await build({
      root: app.appDir,
      logLevel: 'error',
      resolve: { alias: { '@shared': SHARED_DIR } },
      plugins: [viteSingleFile()],
      build: {
        target: 'esnext',
        outDir: path.join(DIST_DIR, app.id),
        emptyOutDir: true,
        rollupOptions: { input: app.htmlPath },
        minify: 'esbuild',
      },
    });
    return { app, success: true };
  } catch (e: unknown) {
    return { app, success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function runBatch(apps: AppEntry[], concurrency: number) {
  const results = [];
  for (let i = 0; i < apps.length; i += concurrency) {
    const batch = apps.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(buildApp))));
  }
  return results;
}

const apps = discoverApps();
if (apps.length === 0) {
  console.log('No apps found to build.');
  process.exit(0);
}

console.log('Building MCP Apps...\n');
const start = Date.now();
const results = await runBatch(apps, 2);

let success = 0,
  failed = 0;
for (const r of results) {
  if (r.success) {
    console.log(`✅ ${r.app.id}`);
    success++;
  } else {
    console.error(`❌ ${r.app.id}: ${r.error}`);
    failed++;
  }
}

console.log(`\nBuilt ${success} apps in ${((Date.now() - start) / 1000).toFixed(1)}s`);
if (failed > 0) process.exit(1);
