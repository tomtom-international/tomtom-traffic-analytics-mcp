/*
 * Copyright (C) 2025 TomTom NV
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Build a self-contained per-OS .mcpb bundle.
 *
 * Output: dist/mcpb/tomtom-traffic-analytics-mcp-{platform}-{arch}.mcpb
 *
 * Each bundle ships its own Node runtime, the compiled app, and the
 * platform-specific DuckDB native binding. Users do not need Node
 * installed locally and the bundle is launched as `type: binary`,
 * which avoids the macOS Hardened Runtime library-validation
 * restriction that blocks dlopen of non-Anthropic-signed native
 * modules inside Claude Desktop's Electron UtilityProcess sandbox.
 *
 * Cross-platform: this script targets `process.platform` /
 * `process.arch` of the host it runs on. To produce bundles for
 * other operating systems, run it on a matching host (or use a CI
 * matrix that runs it on darwin-arm64, darwin-x64, linux-x64, and
 * win32-x64 runners).
 *
 * Usage:
 *   npm run build       # produces dist/index.cjs.js (prerequisite)
 *   npm run build:mcpb  # this script
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

// Bundled Node version. Pinned for reproducible ABI (Node 24.x = ABI 137,
// which matches the prebuilt @duckdb/node-bindings-* shipped on npm).
const NODE_VERSION = '24.13.1';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const NODE_MODULES = path.join(PROJECT_ROOT, 'node_modules');
const PLATFORM = process.platform;
const ARCH = process.arch;
const OUTPUT_DIR = path.join(DIST_DIR, 'mcpb');
const OUTPUT_MCPB = path.join(
  OUTPUT_DIR,
  `tomtom-traffic-analytics-mcp-${PLATFORM}-${ARCH}.mcpb`
);

const TEMP_DIR = path.join(
  os.tmpdir(),
  `tomtom-traffic-analytics-mcp-build-${Date.now()}`
);

console.log(`Building tomtom-traffic-analytics-mcp-${PLATFORM}-${ARCH}.mcpb...`);
console.log(`  Target: Node.js ${NODE_VERSION} for ${PLATFORM}-${ARCH}`);

function getNodeDownloadUrl() {
  const platform = PLATFORM === 'win32' ? 'win' : PLATFORM;
  const arch = ARCH === 'arm64' ? 'arm64' : 'x64';
  const ext = PLATFORM === 'win32' ? 'zip' : 'tar.gz';
  return `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${platform}-${arch}.${ext}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const follow = (currentUrl) => {
      https
        .get(currentUrl, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            return follow(response.headers.location);
          }
          if (response.statusCode !== 200) {
            return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          }
          response.pipe(file);
          file.on('finish', () => file.close(resolve));
        })
        .on('error', reject);
    };
    follow(url);
  });
}

async function extractNodeDist(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execSync(`tar -x${PLATFORM === 'win32' ? 'f' : 'zf'} "${archivePath}" -C "${destDir}"`, {
    stdio: 'pipe',
  });
  const extracted = fs.readdirSync(destDir).find((f) => f.startsWith('node-'));
  if (!extracted) {
    throw new Error('Could not find extracted Node.js directory');
  }
  return PLATFORM === 'win32'
    ? path.join(destDir, extracted, 'node.exe')
    : path.join(destDir, extracted, 'bin', 'node');
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(srcPath);
      try {
        fs.symlinkSync(target, destPath);
      } catch {
        fs.copyFileSync(srcPath, destPath);
      }
    } else if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      fs.chmodSync(destPath, fs.statSync(srcPath).mode);
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const startTime = Date.now();

  if (!fs.existsSync(path.join(DIST_DIR, 'index.cjs.js'))) {
    console.error('Error: dist/index.cjs.js not found. Run "npm run build" first.');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(PROJECT_ROOT, 'manifest-binary.json'))) {
    console.error('Error: manifest-binary.json not found at project root.');
    process.exit(1);
  }

  try {
    fs.mkdirSync(path.join(TEMP_DIR, 'bin', 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(TEMP_DIR, 'bin', 'app'), { recursive: true });
    fs.mkdirSync(path.join(TEMP_DIR, 'download'), { recursive: true });

    // 1. Download Node.js for the target platform
    const nodeUrl = getNodeDownloadUrl();
    const archiveExt = PLATFORM === 'win32' ? 'zip' : 'tar.gz';
    const archivePath = path.join(TEMP_DIR, 'download', `node.${archiveExt}`);
    console.log(`  ↓ Downloading Node.js ${NODE_VERSION}...`);
    await download(nodeUrl, archivePath);

    // 2. Extract Node and copy the binary into the bundle's runtime dir
    const nodeBinary = await extractNodeDist(archivePath, path.join(TEMP_DIR, 'download'));
    const nodeDest = path.join(
      TEMP_DIR,
      'bin',
      'runtime',
      PLATFORM === 'win32' ? 'node.exe' : 'node'
    );
    fs.copyFileSync(nodeBinary, nodeDest);
    if (PLATFORM !== 'win32') fs.chmodSync(nodeDest, 0o755);
    const abi = execSync(`"${nodeDest}" -e "process.stdout.write(process.versions.modules)"`)
      .toString()
      .trim();
    console.log(`  ✓ Node.js ${NODE_VERSION} (ABI ${abi})`);

    // 3. Copy the compiled app + a minimal package.json
    const appDir = path.join(TEMP_DIR, 'bin', 'app');
    fs.copyFileSync(
      path.join(DIST_DIR, 'index.cjs.js'),
      path.join(appDir, 'index.cjs.js')
    );
    if (fs.existsSync(path.join(DIST_DIR, 'index.cjs.js.map'))) {
      fs.copyFileSync(
        path.join(DIST_DIR, 'index.cjs.js.map'),
        path.join(appDir, 'index.cjs.js.map')
      );
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    fs.writeFileSync(
      path.join(appDir, 'package.json'),
      JSON.stringify(
        { name: pkg.name, version: pkg.version, main: 'index.cjs.js', type: 'commonjs' },
        null,
        2
      )
    );
    console.log('  ✓ Application files');

    // 4. Copy node_modules (host already has the right DuckDB platform binding
    //    via @duckdb/node-api's optionalDependencies for PLATFORM-ARCH).
    copyDir(NODE_MODULES, path.join(appDir, 'node_modules'));
    console.log('  ✓ Dependencies');

    // 5. Generate the OS-appropriate launcher
    const binDir = path.join(TEMP_DIR, 'bin');
    if (PLATFORM === 'win32') {
      fs.writeFileSync(
        path.join(binDir, 'tomtom-traffic-analytics-mcp.cmd'),
        '@echo off\r\n' +
          'setlocal\r\n' +
          'set "SCRIPT_DIR=%~dp0"\r\n' +
          'set "NODE_PATH=%SCRIPT_DIR%app\\node_modules"\r\n' +
          '"%SCRIPT_DIR%runtime\\node.exe" "%SCRIPT_DIR%app\\index.cjs.js" %*\r\n'
      );
    } else {
      const launcher = path.join(binDir, 'tomtom-traffic-analytics-mcp');
      fs.writeFileSync(
        launcher,
        '#!/bin/bash\n' +
          'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
          'export NODE_PATH="$SCRIPT_DIR/app/node_modules"\n' +
          'exec "$SCRIPT_DIR/runtime/node" "$SCRIPT_DIR/app/index.cjs.js" "$@"\n'
      );
      fs.chmodSync(launcher, 0o755);
    }
    console.log('  ✓ Launcher');

    // 6. Patch the manifest template with the OS-specific launcher path
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, 'manifest-binary.json'), 'utf8')
    );
    const launcherPath =
      PLATFORM === 'win32'
        ? 'bin/tomtom-traffic-analytics-mcp.cmd'
        : 'bin/tomtom-traffic-analytics-mcp';
    manifest.server.entry_point = launcherPath;
    manifest.server.mcp_config.command = '${__dirname}/' + launcherPath;
    fs.writeFileSync(
      path.join(TEMP_DIR, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    console.log('  ✓ Manifest');

    // 7. Copy images (icon for Claude Desktop install prompt)
    const imagesSrc = path.join(PROJECT_ROOT, 'images');
    if (fs.existsSync(imagesSrc)) {
      copyDir(imagesSrc, path.join(TEMP_DIR, 'images'));
    }

    // 8. Drop the download folder before zipping
    const downloadDir = path.join(TEMP_DIR, 'download');
    if (fs.existsSync(downloadDir)) fs.rmSync(downloadDir, { recursive: true });

    // 9. Zip the bundle
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (fs.existsSync(OUTPUT_MCPB)) fs.unlinkSync(OUTPUT_MCPB);
    const archiver = require('archiver');
    const output = fs.createWriteStream(OUTPUT_MCPB);
    const archive = archiver('zip', { zlib: { level: 9 } });
    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(TEMP_DIR, false);
      archive.finalize();
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const mcpbSize = fs.statSync(OUTPUT_MCPB).size;
    console.log(
      `  ✓ Created tomtom-traffic-analytics-mcp-${PLATFORM}-${ARCH}.mcpb (${formatSize(mcpbSize)}) in ${elapsed}s`
    );
    console.log(`  → ${OUTPUT_MCPB}`);
  } finally {
    if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true });
  }
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
