// Node wrapper for scripts/sandbox-branch-spike.py -- see sandbox-smoke.mjs.
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const venvPython = process.platform === "win32" ? path.join(root, ".venv-sandbox", "Scripts", "python.exe") : path.join(root, ".venv-sandbox", "bin", "python3");
const python = existsSync(venvPython) ? venvPython : "python3";

const child = spawn(python, [path.join("scripts", "sandbox-branch-spike.py")], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error(`Could not start ${python}: ${err.message}`);
  process.exit(1);
});
