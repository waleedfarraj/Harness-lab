// Node wrapper for scripts/sandbox-smoke.py: locates a Python interpreter
// (preferring .venv-sandbox if set up) and runs the smoke test with this
// process's environment (so `node --env-file=.env.local` -> env vars reach
// the Python child). See requirements-sandbox.txt for setup.
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const venvPython = process.platform === "win32" ? path.join(root, ".venv-sandbox", "Scripts", "python.exe") : path.join(root, ".venv-sandbox", "bin", "python3");
const python = existsSync(venvPython) ? venvPython : "python3";

const child = spawn(python, [path.join("scripts", "sandbox-smoke.py")], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error(`Could not start ${python}: ${err.message}`);
  console.error("Set up the sandbox Python env first: see requirements-sandbox.txt");
  process.exit(1);
});
