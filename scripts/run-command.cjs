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

// Shared by build-mcpb.cjs and verify-mcpb.cjs, which both have to invoke `pnpm`.
//
// On Windows that needs `shell: true`: pnpm is a .CMD, which Node refuses to execute
// directly. With a shell, Node concatenates the command and its arguments into one
// string without escaping anything — this is what DEP0190 warns about — so an argument
// holding a space, such as a staging path under `C:\Users\First Last\`, arrives at the
// child as several argv entries. Both scripts pass temp and output paths, so quote them.

const { execFileSync } = require("node:child_process");

function quoteForShell(arg) {
  // Paths are all this is ever given. A literal double quote would need escaping rules
  // that differ per shell, so refuse rather than guess.
  if (arg.includes('"')) {
    throw new Error(`cannot safely pass an argument containing a double quote: ${arg}`);
  }
  return `"${arg}"`;
}

function run(command, args, options = {}) {
  const shell = process.platform === "win32";
  const execOptions = { stdio: "pipe", ...options, shell };
  try {
    // On Windows the command line is assembled and quoted here and handed over as the
    // file, rather than passing `args` for Node to concatenate unescaped — which is both
    // the bug above and what DEP0190 warns about, so this drops the warning too.
    return shell
      ? execFileSync(`${command} ${args.map(quoteForShell).join(" ")}`, execOptions)
      : execFileSync(command, args, execOptions);
  } catch (err) {
    // execFileSync's own message is just "Command failed"; the reason is on stderr.
    const detail = err.stderr?.toString() || err.stdout?.toString() || err.message;
    throw new Error(`\`${command} ${args.join(" ")}\` failed:\n${detail}`);
  }
}

module.exports = { run };
