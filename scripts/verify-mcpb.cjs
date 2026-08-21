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

// Unpacks the built .mcpb and runs the server out of it, the way a user's machine would.
// Building a bundle is not evidence that it runs: a bundle whose query engine cannot
// start packs perfectly and only throws when a tool first evaluates a query.
//
// Everything here goes through the bundle's *own* embedded Node runtime and launcher,
// never this process's node, because that is what Claude Desktop invokes.
//
// build-mcpb.cjs checks the staged tree before packing; this checks the artifact.

const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { run } = require("./run-command.cjs");

const TARGET = `${process.platform}-${process.arch}`;
const PROJECT_ROOT = path.resolve(__dirname, "..");
const BUNDLE = path.join(
  PROJECT_ROOT,
  "dist",
  "mcpb",
  `tomtom-traffic-analytics-mcp-${TARGET}.mcpb`
);

// Run in a child rather than in this process so the extracted bundle can be deleted
// afterwards on every platform, and so a WASM abort cannot take the verifier with it.
//
// Instantiating the sandbox is the check: the QuickJS WASM module is compiled into the
// app bundle, and a truncated or mis-packed bundle fails here rather than at first use.
const SANDBOX_PROBE = `
  const path = require("node:path");
  const { newQuickJSWASMModuleFromVariant } = require(
    path.join(process.argv[1], "node_modules", "quickjs-emscripten-core")
  );
  const variant = require(
    path.join(process.argv[1], "node_modules", "@jitl", "quickjs-singlefile-cjs-release-sync")
  );
  newQuickJSWASMModuleFromVariant(variant.default ?? variant)
    .then((mod) => {
      const vm = mod.newContext();
      const result = vm.unwrapResult(vm.evalCode("[1, 2, 3].reduce((a, b) => a + b, 0)"));
      const total = vm.getNumber(result);
      result.dispose();
      vm.dispose();
      if (total !== 6) throw new Error("sandbox returned " + total + ", expected 6");
    })
    .catch((err) => {
      console.error(err.stack || err.message);
      process.exit(1);
    });
`;

function bundledNode(dir) {
  const runtime = path.join(
    dir,
    "bin",
    "runtime",
    process.platform === "win32" ? "node.exe" : "node"
  );
  if (!fs.existsSync(runtime)) {
    throw new Error(`the bundle ships no Node runtime at ${path.relative(dir, runtime)}`);
  }
  return runtime;
}

// The launcher and the embedded Node binary are only executable if the packer stored Unix
// modes and the extractor restored them. Without the bit, Claude Desktop's spawn of a
// `type: binary` entry point fails with EACCES — after install, on first use.
function assertExecutable(...files) {
  if (process.platform === "win32") return;
  for (const file of files) {
    if ((fs.statSync(file).mode & 0o111) === 0) {
      throw new Error(
        `${path.basename(file)} came out of the bundle without an executable bit, so ` +
          `Claude Desktop cannot spawn it`
      );
    }
  }
}

// Exercising the sandbox directly gives a precise error; reaching it only through the
// server would surface the same fault as a generic tool failure. Uses the bundle's own
// runtime, since that is the one that has to load the WASM module.
function assertSandboxEvaluates(dir) {
  const appDir = path.join(dir, "bin", "app");
  try {
    execFileSync(bundledNode(dir), ["-e", SANDBOX_PROBE, appDir], { stdio: "pipe" });
  } catch (err) {
    const detail = err.stderr?.toString() || err.stdout?.toString() || err.message;
    throw new Error(`the bundled QuickJS sandbox could not evaluate JavaScript:\n${detail}`);
  }
}

function request(id, method, params) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`;
}

// Drives the extracted server over stdio and returns its responses.
function handshake(launcher) {
  return new Promise((resolve, reject) => {
    const child = spawn(launcher, [], {
      stdio: ["pipe", "pipe", "pipe"],
      // The .cmd launcher is a batch file, which Node cannot execute directly.
      shell: process.platform === "win32",
      env: { ...process.env, TOMTOM_API_KEY: "verify", TOMTOM_MOVE_PORTAL_KEY: "verify" },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`server did not answer within 60s.\nstderr:\n${stderr}`));
    }, 60_000);

    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!stdout) {
        reject(new Error(`server exited with code ${code} and said nothing.\nstderr:\n${stderr}`));
        return;
      }
      // Line by line rather than `.map(JSON.parse)`, so that anything on stdout which is
      // not a JSON-RPC message names itself. That is the failure worth reporting clearly:
      // stray stdout output corrupts MCP framing for every client, and a bare parse error
      // would obscure the one regression this handshake is placed to catch.
      const responses = [];
      for (const line of stdout.split("\n").filter(Boolean)) {
        try {
          responses.push(JSON.parse(line));
        } catch {
          reject(
            new Error(
              `non-JSON output on the server's stdout, which corrupts MCP framing:\n  ${line}\n` +
                `stderr:\n${stderr}`
            )
          );
          return;
        }
      }
      resolve(responses);
    });

    child.stdin.write(
      request(1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "verify-mcpb", version: "1" },
      })
    );
    child.stdin.write(request(2, "tools/list"));
    child.stdin.end();
  });
}

async function main() {
  if (!fs.existsSync(BUNDLE)) {
    throw new Error(
      `no bundle at ${path.relative(PROJECT_ROOT, BUNDLE)} — run \`pnpm run build:mcpb\``
    );
  }
  console.log(`Verifying ${path.basename(BUNDLE)}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttam-verify-"));
  try {
    run("pnpm", ["exec", "mcpb", "unpack", BUNDLE, dir], { cwd: PROJECT_ROOT });
    console.log("  ✓ Unpacked");

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    const launcher = path.join(dir, manifest.server.entry_point);
    if (!fs.existsSync(launcher)) {
      throw new Error(`manifest entry_point ${manifest.server.entry_point} is not in the bundle`);
    }
    assertExecutable(launcher, bundledNode(dir));
    console.log("  ✓ Launcher and embedded Node runtime are executable");

    assertSandboxEvaluates(dir);
    console.log("  ✓ QuickJS sandbox evaluates JavaScript");

    const responses = await handshake(launcher);
    const initialize = responses.find((r) => r.id === 1);
    const tools = responses.find((r) => r.id === 2)?.result?.tools;

    if (!initialize?.result?.serverInfo) {
      throw new Error(`initialize failed: ${JSON.stringify(initialize)}`);
    }
    if (!tools?.length) {
      throw new Error(`tools/list returned no tools: ${JSON.stringify(responses)}`);
    }
    console.log(`  ✓ MCP handshake, ${tools.length} tools listed`);
    console.log(`Bundle for ${TARGET} verified.`);
  } finally {
    // Both children that touch the extracted tree have exited by now, so this should
    // succeed on every platform. Still best effort: the directory is under the OS temp
    // dir and every check has already run, so failing to remove it says nothing about the
    // bundle and must not fail a good one.
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`  ! left ${dir} behind: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(`\nBundle verification failed:\n${err.message}`);
  process.exit(1);
});
