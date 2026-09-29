import "server-only";

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { listLocalFiles, readLocalFile } from "../agent/local-fs";
import { FIXTURE_COPY_ENTRIES } from "../experiments/fixture-copy";
import type { SandboxCommand, SandboxCreateOptions, SandboxExecResult, SandboxHandle, SandboxRunner } from "./types";

/**
 * Real adapter onto Nebius Token Factory Sandboxes, via the official Python
 * `contree-sdk` (there is no first-party TypeScript/JS SDK). TypeScript
 * spawns `scripts/contree-bridge.py` once per operation with a small JSON
 * request on stdin and reads a JSON response from stdout — no long-running
 * daemon, no terminal-output scraping.
 *
 * MISMATCH WITH THE LOCAL RUNNER (documented, not papered over): Contree's
 * unit of state is a checkpoint/image UUID, not a filesystem path. There is
 * no `sandbox.root`; instead `sandbox.checkpoint` is threaded through and
 * updated in place after every operation that changes filesystem state
 * (`create`, `execute`, `write_file`). Callers must keep reusing the SAME
 * handle instance for one experiment — this runner mutates it, it doesn't
 * return a new one each time.
 *
 * `SandboxCommand.cwd` is not supported (no local-path concept to point at);
 * every command runs relative to wherever the base image's default working
 * directory is. This is a genuine, small local-vs-remote behavior
 * difference — see the Milestone 3.5 report.
 */

export class SandboxNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`Token Factory Sandbox is not configured: ${reason}.`);
    this.name = "SandboxNotConfiguredError";
  }
}

export class SandboxBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxBridgeError";
  }
}

const BRIDGE_SCRIPT = path.join(process.cwd(), "scripts", "contree-bridge.py");
const BASE_IMAGE = "node:22-slim";

interface BridgeRequest {
  op: "create" | "execute" | "read_file" | "write_file" | "list_files" | "destroy";
  base_image?: string;
  files?: Record<string, string>;
  checkpoint?: string;
  command?: string;
  env?: Record<string, string>;
  timeout?: number;
  path?: string;
  content?: string;
  dir?: string;
}

interface BridgeResponse {
  ok: boolean;
  error?: string;
  checkpoint?: string;
  baseImage?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  content?: string;
  files?: string[];
  note?: string;
}

/** Runtime validation of untrusted subprocess output — never trust a bare `as` cast on bridge JSON. */
function parseBridgeResponse(raw: string): BridgeResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("ok" in parsed) || typeof (parsed as { ok: unknown }).ok !== "boolean") {
    return null;
  }
  return parsed as BridgeResponse;
}

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Only the two control-plane credentials the bridge needs to authenticate — nothing else from this process's env. */
function bridgeProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.NEBIUS_API_KEY) env.NEBIUS_API_KEY = process.env.NEBIUS_API_KEY;
  if (process.env.NEBIUS_PROJECT_ID) env.NEBIUS_PROJECT_ID = process.env.NEBIUS_PROJECT_ID;
  if (process.env.NEBIUS_SANDBOX_BASE_URL) env.NEBIUS_SANDBOX_BASE_URL = process.env.NEBIUS_SANDBOX_BASE_URL;
  return env;
}

function pythonInterpreter(): string {
  const venv = process.platform === "win32" ? path.join(process.cwd(), ".venv-sandbox", "Scripts", "python.exe") : path.join(process.cwd(), ".venv-sandbox", "bin", "python3");
  return existsSync(venv) ? venv : "python3";
}

export interface TokenFactorySandboxRunnerOptions {
  /** Injected for tests: the argv used to spawn the bridge. Defaults to [python, contree-bridge.py]. */
  command?: string[];
  /** Injected for tests; overrides env passed to the bridge process. Defaults to bridgeProcessEnv(). */
  env?: Record<string, string>;
  /** Injected for tests; skips the NEBIUS_API_KEY/NEBIUS_PROJECT_ID check. */
  skipConfigCheck?: boolean;
  /** Overrides the default per-call bridge process timeout (60s). Mainly for tests. */
  bridgeTimeoutMs?: number;
}

const DEFAULT_BRIDGE_TIMEOUT_MS = 60_000;

export class TokenFactorySandboxRunner implements SandboxRunner {
  constructor(private readonly options: TokenFactorySandboxRunnerOptions = {}) {}

  private assertConfigured(): void {
    if (this.options.skipConfigCheck) return;
    if (!process.env.NEBIUS_API_KEY?.trim()) throw new SandboxNotConfiguredError("NEBIUS_API_KEY is not set");
    if (!process.env.NEBIUS_PROJECT_ID?.trim()) throw new SandboxNotConfiguredError("NEBIUS_PROJECT_ID is not set");
  }

  private callBridge(request: BridgeRequest, bridgeTimeoutMs = this.options.bridgeTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS): Promise<BridgeResponse> {
    this.assertConfigured();
    const [command, ...args] = this.options.command ?? [pythonInterpreter(), BRIDGE_SCRIPT];
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: (this.options.env ?? bridgeProcessEnv()) as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(new SandboxBridgeError(`bridge did not respond within ${bridgeTimeoutMs} ms (op: ${request.op})`));
      }, bridgeTimeoutMs);

      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new SandboxBridgeError(`could not start the Contree bridge (${command}): ${err.message}`));
      });
      child.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const parsed = parseBridgeResponse(stdout.trim());
        if (!parsed) {
          reject(new SandboxBridgeError(`bridge returned invalid output: ${(stderr || stdout).slice(0, 1000)}`));
          return;
        }
        resolve(parsed);
      });
      child.stdin.write(JSON.stringify(request));
      child.stdin.end();
    });
  }

  async create(options: SandboxCreateOptions = {}): Promise<SandboxHandle> {
    if (!options.fixturePath) throw new Error("TokenFactorySandboxRunner.create requires options.fixturePath");
    const fixtureRoot = path.resolve(options.fixturePath);

    const files: Record<string, string> = {};
    for (const entry of FIXTURE_COPY_ENTRIES) {
      const entryAbs = path.join(fixtureRoot, entry);
      if (!existsSync(entryAbs)) continue;
      const relFiles = statSync(entryAbs).isDirectory() ? listLocalFiles(fixtureRoot, entry) : [entry];
      for (const rel of relFiles) {
        files[rel] = readLocalFile(fixtureRoot, rel);
      }
    }

    const response = await this.callBridge({ op: "create", base_image: BASE_IMAGE, files });
    if (!response.ok || !response.checkpoint) throw new SandboxBridgeError(response.error ?? "create failed with no error detail");

    const id = `${options.label ?? "run"}-${crypto.randomUUID()}`;
    return { id, checkpoint: response.checkpoint, metadata: { baseImage: BASE_IMAGE, forkedFrom: null } };
  }

  /**
   * No bridge call at all: Contree's checkpoints are already forkable by
   * construction (verified in the Milestone 3.5 branch spike — multiple
   * independent operations starting from the same checkpoint UUID produce
   * independent results). Forking here is just handing out a new handle
   * that starts from the same checkpoint string; the actual "fork" happens
   * implicitly the first time this handle's execute/write_file runs.
   */
  async forkFrom(base: SandboxHandle, label?: string): Promise<SandboxHandle> {
    if (!base.checkpoint) throw new Error("TokenFactorySandboxRunner.forkFrom: base handle has no checkpoint");
    const id = `${label ?? "fork"}-${crypto.randomUUID()}`;
    return { id, checkpoint: base.checkpoint, metadata: { ...base.metadata, forkedFrom: base.checkpoint } };
  }

  async execute(sandbox: SandboxHandle, command: SandboxCommand): Promise<SandboxExecResult> {
    if (!sandbox.checkpoint) throw new Error("TokenFactorySandboxRunner.execute: sandbox handle has no checkpoint");
    const started = Date.now();
    const shell = [command.command, ...(command.args ?? [])].map(shellQuote).join(" ");
    const response = await this.callBridge(
      {
        op: "execute",
        checkpoint: sandbox.checkpoint,
        command: shell,
        env: command.env ?? {},
        timeout: command.timeoutMs ? Math.ceil(command.timeoutMs / 1000) : undefined,
      },
      command.timeoutMs ? command.timeoutMs + 15_000 : (this.options.bridgeTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS),
    );
    if (!response.ok) throw new SandboxBridgeError(response.error ?? "execute failed with no error detail");
    if (response.checkpoint) sandbox.checkpoint = response.checkpoint;
    return {
      exitCode: response.exitCode ?? -1,
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      durationMs: Date.now() - started,
      metadata: { checkpoint: response.checkpoint },
    };
  }

  async listFiles(sandbox: SandboxHandle, dir: string): Promise<string[]> {
    if (!sandbox.checkpoint) throw new Error("TokenFactorySandboxRunner.listFiles: sandbox handle has no checkpoint");
    const response = await this.callBridge({ op: "list_files", checkpoint: sandbox.checkpoint, dir });
    if (!response.ok) throw new SandboxBridgeError(response.error ?? "list_files failed with no error detail");
    return response.files ?? [];
  }

  async readFile(sandbox: SandboxHandle, relPath: string): Promise<string> {
    if (!sandbox.checkpoint) throw new Error("TokenFactorySandboxRunner.readFile: sandbox handle has no checkpoint");
    const response = await this.callBridge({ op: "read_file", checkpoint: sandbox.checkpoint, path: relPath });
    if (!response.ok) throw new SandboxBridgeError(response.error ?? `read_file failed: ${relPath}`);
    return response.content ?? "";
  }

  async writeFile(sandbox: SandboxHandle, relPath: string, content: string): Promise<void> {
    if (!sandbox.checkpoint) throw new Error("TokenFactorySandboxRunner.writeFile: sandbox handle has no checkpoint");
    const response = await this.callBridge({ op: "write_file", checkpoint: sandbox.checkpoint, path: relPath, content });
    if (!response.ok) throw new SandboxBridgeError(response.error ?? `write_file failed: ${relPath}`);
    if (response.checkpoint) sandbox.checkpoint = response.checkpoint;
  }

  async destroy(sandbox: SandboxHandle): Promise<void> {
    if (!sandbox.checkpoint) return;
    await this.callBridge({ op: "destroy", checkpoint: sandbox.checkpoint });
  }
}
