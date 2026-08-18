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

// Builds a self-contained, per-OS .mcpb bundle from a staging directory rather than
// packing the repo, so the bundle holds the runtime dependency tree instead of whatever
// node_modules happens to contain.
//
// Output: dist/mcpb/tomtom-traffic-analytics-mcp-{platform}-{arch}.mcpb
//
// Each bundle ships its own Node runtime, the compiled app, and the platform-specific
// DuckDB native binding, and is launched as `type: binary`. Users need no Node
// installed, and the launcher avoids the macOS Hardened Runtime library-validation
// restriction that blocks dlopen of non-Anthropic-signed native modules inside Claude
// Desktop's Electron UtilityProcess sandbox.
//
// The bundle is platform-specific twice over: the embedded Node binary is one OS/arch
// build, and @duckdb/node-bindings requires a per-platform binary that ships as an
// optionalDependency, so only the build host's is ever installed. CI runs this on a
// native runner per target.
//
// Usage:
//   pnpm run build       # produces dist/index.cjs.js (prerequisite)
//   pnpm run build:mcpb  # this script

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { run } = require("./run-command.cjs");

// Bundled Node version. Pinned for reproducible ABI (Node 24.x = ABI 137, which matches
// the prebuilt @duckdb/node-bindings-* shipped on npm).
const NODE_VERSION = "24.13.1";

const PLATFORM = process.platform;
const ARCH = process.arch;
const TARGET = `${PLATFORM}-${ARCH}`;
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const OUTPUT_DIR = path.join(DIST_DIR, "mcpb");
const OUTPUT_FILE = path.join(OUTPUT_DIR, `tomtom-traffic-analytics-mcp-${TARGET}.mcpb`);

// Copied into the staged app directory only to drive the install. pnpm-workspace.yaml
// carries the overrides the lockfile is validated against, so --frozen-lockfile fails
// without it (ERR_PNPM_LOCKFILE_CONFIG_MISMATCH). All three are removed afterwards; the
// app keeps a minimal package.json of its own instead.
const INSTALL_FILES = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];

function pnpm(args, cwd) {
  run("pnpm", args, { cwd, env: { ...process.env, CI: "true" } });
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// CI knows which target a matrix job should produce; this process only knows what it
// runs on. They diverge if a runner is not the machine the matrix assumed — an arm64
// runner that ends up with an emulated x64 Node reports x64 here, and would quietly
// produce a second x64 bundle under an arm64 name, past every other check.
function assertExpectedTarget() {
  const expected = process.env.MCPB_EXPECT_TARGET;
  if (expected && expected !== TARGET) {
    throw new Error(
      `expected to build ${expected} but this host is ${TARGET} ` +
        `(node ${process.version}). Check the runner and that Node is native, not emulated.`
    );
  }
}

function getNodeDownloadUrl() {
  const platform = PLATFORM === "win32" ? "win" : PLATFORM;
  const arch = ARCH === "arm64" ? "arm64" : "x64";
  const ext = PLATFORM === "win32" ? "zip" : "tar.gz";
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
          file.on("finish", () => file.close(resolve));
        })
        .on("error", reject);
    };
    follow(url);
  });
}

function extractNodeDist(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // bsdtar on macOS and Windows reads zip; GNU tar on Linux does not, but the Linux
  // download is a tarball, so each platform only ever asks tar for a format it handles.
  run("tar", [PLATFORM === "win32" ? "-xf" : "-xzf", archivePath, "-C", destDir]);
  const extracted = fs.readdirSync(destDir).find((f) => f.startsWith("node-"));
  if (!extracted) {
    throw new Error("Could not find extracted Node.js directory");
  }
  return PLATFORM === "win32"
    ? path.join(destDir, extracted, "node.exe")
    : path.join(destDir, extracted, "bin", "node");
}

async function stageNodeRuntime(runtimeDir, downloadDir) {
  const archiveExt = PLATFORM === "win32" ? "zip" : "tar.gz";
  const archivePath = path.join(downloadDir, `node.${archiveExt}`);
  console.log(`  ↓ Downloading Node.js ${NODE_VERSION}...`);
  await download(getNodeDownloadUrl(), archivePath);

  const nodeBinary = extractNodeDist(archivePath, downloadDir);
  const nodeDest = path.join(runtimeDir, PLATFORM === "win32" ? "node.exe" : "node");
  fs.copyFileSync(nodeBinary, nodeDest);
  if (PLATFORM !== "win32") fs.chmodSync(nodeDest, 0o755);

  const abi = execFileSync(nodeDest, ["-e", "process.stdout.write(process.versions.modules)"])
    .toString()
    .trim();
  console.log(`  ✓ Node.js ${NODE_VERSION} (ABI ${abi})`);
  return nodeDest;
}

function stageApplicationFiles(appDir) {
  fs.copyFileSync(path.join(DIST_DIR, "index.cjs.js"), path.join(appDir, "index.cjs.js"));

  // The bundle runs one CommonJS file, so it needs its own package.json: the repo's
  // declares "type": "module", under which Node would parse index.cjs.js — a .js file —
  // as ESM and fail on its first require.
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    `${JSON.stringify(
      { name: pkg.name, version: pkg.version, main: "index.cjs.js", type: "commonjs" },
      null,
      2
    )}\n`
  );
}

function installProductionDeps(appDir) {
  const appPackageJson = fs.readFileSync(path.join(appDir, "package.json"), "utf8");
  for (const file of INSTALL_FILES) {
    fs.copyFileSync(path.join(PROJECT_ROOT, file), path.join(appDir, file));
  }
  try {
    // --config.node-linker=hoisted gives real directories rather than pnpm's default
    // symlinks into .pnpm; see assertNoSymlinks below for why that matters.
    //
    // --ignore-scripts because the repo package.json copied in above still carries the
    // `prepare` hook (`pnpm run build`), which would run here and fail — there are no
    // sources to build. It also skips dependencies' install scripts, which is safe only
    // while no *production* dependency has one. Today none does; `allowBuilds` in
    // pnpm-workspace.yaml is the list to check, and if a runtime package ever appears
    // there, this needs an --ignore-scripts=false path for it. verify-mcpb.cjs is what
    // would catch the omission, by failing to run the bundle.
    pnpm(
      [
        "install",
        "--prod",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--config.node-linker=hoisted",
      ],
      appDir
    );
  } finally {
    // Put the app's own minimal package.json back over the repo one.
    fs.writeFileSync(path.join(appDir, "package.json"), appPackageJson);
    for (const file of INSTALL_FILES.filter((f) => f !== "package.json")) {
      fs.rmSync(path.join(appDir, file), { force: true });
    }
    // pnpm's own bookkeeping, plus .bin — CLI shims for dependencies, which are symlinks
    // and which nothing in the bundle runs. None of it is read at runtime.
    for (const leftover of [".pnpm", ".pnpm-workspace-state-v1.json", ".modules.yaml", ".bin"]) {
      fs.rmSync(path.join(appDir, "node_modules", leftover), { recursive: true, force: true });
    }
  }
}

// The whole point of building on a native runner: @duckdb/node-bindings picks its binary
// by ${process.platform}-${process.arch} from optionalDependencies, so a host that
// resolved none of them packs a bundle that throws on the first require of the SQL
// engine — which every tool goes through.
function assertDuckDbBindingStaged(appDir) {
  const binding = path.join(appDir, "node_modules", "@duckdb", `node-bindings-${TARGET}`);
  if (!fs.existsSync(binding)) {
    throw new Error(
      `@duckdb/node-bindings-${TARGET} is not in the staged tree. The production ` +
        `install resolved no native binding for this host, so the bundle would fail on ` +
        `its first SQL call.`
    );
  }
}

// A package stored as a symlink only survives extraction by a tool that restores
// symlinks; one that doesn't writes the link target out as a short text file, and the
// server dies on its first require. Checking the staged tree catches that here rather
// than after packing, and needs no assumptions about the extractor.
//
// Deliberately names no package: whether the tree is usable is verify-mcpb.cjs's job, by
// running the thing, so this stays correct as dependencies come and go.
function assertNoSymlinks(stageDir) {
  const links = [];
  for (const entry of fs.readdirSync(stageDir, { recursive: true, withFileTypes: true })) {
    if (entry.isSymbolicLink()) links.push(path.join(entry.parentPath ?? entry.path, entry.name));
  }
  if (links.length > 0) {
    throw new Error(
      `bundle tree contains ${links.length} symlink(s), which will not survive every ` +
        `extractor:\n  ${links.slice(0, 5).join("\n  ")}`
    );
  }
}

// Sets NODE_PATH as well as relying on directory resolution from bin/app, so the bundled
// dependencies are found however the launcher is invoked.
function stageLauncher(binDir) {
  if (PLATFORM === "win32") {
    const launcher = path.join(binDir, "tomtom-traffic-analytics-mcp.cmd");
    fs.writeFileSync(
      launcher,
      "@echo off\r\n" +
        "setlocal\r\n" +
        'set "SCRIPT_DIR=%~dp0"\r\n' +
        'set "NODE_PATH=%SCRIPT_DIR%app\\node_modules"\r\n' +
        '"%SCRIPT_DIR%runtime\\node.exe" "%SCRIPT_DIR%app\\index.cjs.js" %*\r\n'
    );
    return "bin/tomtom-traffic-analytics-mcp.cmd";
  }
  const launcher = path.join(binDir, "tomtom-traffic-analytics-mcp");
  fs.writeFileSync(
    launcher,
    "#!/bin/bash\n" +
      'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
      'export NODE_PATH="$SCRIPT_DIR/app/node_modules"\n' +
      'exec "$SCRIPT_DIR/runtime/node" "$SCRIPT_DIR/app/index.cjs.js" "$@"\n'
  );
  fs.chmodSync(launcher, 0o755);
  return "bin/tomtom-traffic-analytics-mcp";
}

function stageManifest(stageDir, launcherPath) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "manifest-binary.json"), "utf8")
  );
  manifest.server.entry_point = launcherPath;
  manifest.server.mcp_config.command = `\${__dirname}/${launcherPath}`;
  // A bundle should describe itself, not every platform the project can be built for — a
  // darwin bundle advertising win32 is how someone installs one that cannot load its own
  // duckdb binding, or run its own Node binary.
  manifest.compatibility = { ...manifest.compatibility, platforms: [PLATFORM] };
  fs.writeFileSync(path.join(stageDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  const startTime = Date.now();

  if (!fs.existsSync(path.join(DIST_DIR, "index.cjs.js"))) {
    throw new Error("dist/index.cjs.js not found — run `pnpm run build` first.");
  }
  if (!fs.existsSync(path.join(PROJECT_ROOT, "manifest-binary.json"))) {
    throw new Error("manifest-binary.json not found at project root.");
  }
  assertExpectedTarget();

  console.log(`Building tomtom-traffic-analytics-mcp-${TARGET}.mcpb...`);
  console.log(`  Target: Node.js ${NODE_VERSION} for ${TARGET}`);

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "ttam-mcpb-"));
  // Outside the staging directory, so the Node tarball and its extracted tree can never
  // end up in the bundle.
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "ttam-node-"));
  try {
    const binDir = path.join(stageDir, "bin");
    const appDir = path.join(binDir, "app");
    const runtimeDir = path.join(binDir, "runtime");
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });

    await stageNodeRuntime(runtimeDir, downloadDir);

    stageApplicationFiles(appDir);
    console.log("  ✓ Application files");

    installProductionDeps(appDir);
    assertDuckDbBindingStaged(appDir);
    assertNoSymlinks(stageDir);
    console.log("  ✓ Production dependencies");

    const launcherPath = stageLauncher(binDir);
    console.log("  ✓ Launcher");

    stageManifest(stageDir, launcherPath);
    console.log("  ✓ Manifest");

    // Icon for the Claude Desktop install prompt.
    const imagesSrc = path.join(PROJECT_ROOT, "images");
    if (fs.existsSync(imagesSrc)) {
      fs.cpSync(imagesSrc, path.join(stageDir, "images"), { recursive: true });
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.rmSync(OUTPUT_FILE, { force: true });
    // mcpb pack rather than a hand-rolled zip: it validates the manifest against the
    // published schema before writing, and stores Unix file modes, which the launcher
    // and the embedded node binary both need on extraction.
    pnpm(["exec", "mcpb", "pack", stageDir, OUTPUT_FILE], PROJECT_ROOT);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `  ✓ ${path.relative(PROJECT_ROOT, OUTPUT_FILE)} ` +
        `(${formatSize(fs.statSync(OUTPUT_FILE).size)}) in ${elapsed}s`
    );
  } finally {
    // Best effort — the bundle is already written, so losing the staging directory to a
    // locked file (Windows) must not fail a good build.
    for (const dir of [stageDir, downloadDir]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`  ! left ${dir} behind: ${err.message}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(`\nBundle build failed:\n${err.message}`);
  process.exit(1);
});
