import "server-only";

import { execFile, type ExecFileException } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listLocalFiles, readLocalFile, writeLocalFile } from "../agent/local-fs";
import { FIXTURE_COPY_ENTRIES } from "./fixture-copy";
import type { SandboxCommand, SandboxCreateOptions, SandboxExecResult, SandboxHandle, SandboxRunner } from "../sandbox/types";

/**
 * Local fallback for `SandboxRunner`, used while Token Factory Sandbox beta
 * access is pending (see `TokenFactorySandboxRunner`).
 *
 * SECURITY LIMITATIONS — read before using this for anything but a
 * throwaway experiment on a trusted machine:
 *   - This is a temporary directory on the host filesystem, not a
 *     container, VM, or namespace. It shares the host kernel, network
 *     stack, and process table.
 *   - `node_modules` is symlinked in from the HarnessLab project itself
 *     (to reuse its already-installed tsx/typescript without an npm
 *     install per run), so the workspace can see (read-only, by
 *     convention, not enforcement) that dependency tree.
 *   - Isolation is enforced only at two layers: (1) the agent's file tools
 *     refuse to resolve paths outside the workspace directory, and (2)
 *     `execute()` only ever runs the exact binary/args it's given, with a
 *     stripped-down environment — there is no OS-level sandboxing of what
 *     an allowed command can itself do once it starts.
 *   - There is no network restriction. A task fixture that needed network
 *     isolation would not get it here.
 * `TokenFactorySandboxRunner` remains the intended real isolation boundary
 * once Sandbox access/docs exist; do not treat this as equivalent to it.
 */
export class LocalExperimentRunner implements SandboxRunner {
  async create(options: SandboxCreateOptions = {}): Promise<SandboxHandle> {
    if (!options.fixturePath) {
      throw new Error("LocalExperimentRunner.create requires options.fixturePath");
    }
    const fixtureRoot = path.resolve(options.fixturePath);
    if (!fs.existsSync(fixtureRoot)) {
      throw new Error(`fixture not found: ${fixtureRoot}`);
    }

    const id = `${options.label ?? "run"}-${crypto.randomUUID()}`;
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "harnesslab-"));

    for (const entry of FIXTURE_COPY_ENTRIES) {
      const source = path.join(fixtureRoot, entry);
      if (fs.existsSync(source)) {
        await fs.promises.cp(source, path.join(root, entry), { recursive: true });
      }
    }

    await fs.promises.symlink(path.join(process.cwd(), "node_modules"), path.join(root, "node_modules"), "dir");

    await runGit(root, ["init", "-q"]);
    await runGit(root, ["add", "-A"]);
    await runGit(root, [
      "-c",
      "user.email=harnesslab@local",
      "-c",
      "user.name=HarnessLab",
      "commit",
      "-q",
      "-m",
      "canonical fixture state",
    ]);

    return { id, root, metadata: { forkedFrom: null } };
  }

  async forkFrom(base: SandboxHandle, label?: string): Promise<SandboxHandle> {
    if (!base.root) throw new Error("LocalExperimentRunner.forkFrom: base handle has no local root");
    const id = `${label ?? "fork"}-${crypto.randomUUID()}`;
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "harnesslab-"));
    // Copies the whole tree, including the node_modules symlink (copied as a symlink, not
    // dereferenced) and .git — each fork keeps the same starting commit as `base`, so its own
    // `git diff` shows only its own later changes.
    await fs.promises.cp(base.root, root, { recursive: true, verbatimSymlinks: true });
    return { id, root, metadata: { forkedFrom: base.root } };
  }

  async execute(sandbox: SandboxHandle, command: SandboxCommand): Promise<SandboxExecResult> {
    if (!sandbox.root) {
      throw new Error("LocalExperimentRunner.execute: sandbox handle has no local root");
    }
    const started = Date.now();
    // No `env` key at all (rather than `{}`) means execFile falls back to its normal
    // default of inheriting the current process's environment, like any other
    // child_process call. Callers that need a restricted environment (the coding
    // agent's tool layer always does, to keep NEBIUS_API_KEY out of the workspace)
    // pass `command.env` explicitly; this runner never second-guesses that.
    const execOptions = {
      cwd: command.cwd ?? sandbox.root,
      timeout: command.timeoutMs,
      killSignal: "SIGKILL" as const,
      maxBuffer: 2_000_000,
      ...(command.env ? { env: command.env as NodeJS.ProcessEnv } : {}),
    };
    return new Promise((resolve) => {
      execFile(
        command.command,
        command.args ?? [],
        execOptions,
        (error: ExecFileException | null, stdout: string, stderr: string) => {
          const timedOut = Boolean(error?.killed && error.signal === "SIGKILL");
          resolve({
            exitCode: !error ? 0 : typeof error.code === "number" ? error.code : -1,
            stdout,
            stderr,
            durationMs: Date.now() - started,
            timedOut,
          });
        },
      );
    });
  }

  async listFiles(sandbox: SandboxHandle, dir: string): Promise<string[]> {
    if (!sandbox.root) throw new Error("LocalExperimentRunner.listFiles: sandbox handle has no local root");
    return listLocalFiles(sandbox.root, dir);
  }

  async readFile(sandbox: SandboxHandle, relPath: string): Promise<string> {
    if (!sandbox.root) throw new Error("LocalExperimentRunner.readFile: sandbox handle has no local root");
    return readLocalFile(sandbox.root, relPath);
  }

  async writeFile(sandbox: SandboxHandle, relPath: string, content: string): Promise<void> {
    if (!sandbox.root) throw new Error("LocalExperimentRunner.writeFile: sandbox handle has no local root");
    writeLocalFile(sandbox.root, relPath, content);
  }

  async destroy(sandbox: SandboxHandle): Promise<void> {
    if (!sandbox.root) return;
    await fs.promises.rm(sandbox.root, { recursive: true, force: true });
  }
}

function runGit(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error) => (error ? reject(error) : resolve()));
  });
}
