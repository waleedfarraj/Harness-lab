import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { SandboxHandle, SandboxRunner } from "../sandbox/types";
import type { ToolCall, ToolDefinition, ToolExecutionResult, ToolExecutor } from "./types";

/**
 * The coding agent's only access to the outside world. Every function here
 * takes a `workspaceRoot` and refuses to touch anything outside it. See
 * `WorkspaceSecurityError` call sites for the specific rules enforced.
 */

export class WorkspaceSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSecurityError";
  }
}

const BLOCKED_SEGMENTS = new Set([".git", "node_modules"]);
const PROTECTED_FILES = new Set(["package.json", "tsconfig.json"]);
const PROTECTED_DIR_PREFIXES = ["tests/"];

const MAX_READ_CHARS = 40_000;
const MAX_TOOL_OUTPUT_CHARS = 4_000;
const MAX_LISTED_FILES = 500;

/** Only PATH/HOME/tmp vars are passed through; nothing from the app's own env (incl. NEBIUS_API_KEY) ever reaches a workspace command. */
const COMMAND_ENV_ALLOWLIST = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP"];

function commandEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of COMMAND_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function truncate(text: string, max = MAX_TOOL_OUTPUT_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text;
}

/** Resolves a model-supplied relative path against the workspace, rejecting escape attempts. */
export function resolveWorkspacePath(workspaceRoot: string, relPath: string): string {
  if (typeof relPath !== "string" || relPath.trim() === "") {
    throw new WorkspaceSecurityError("path must be a non-empty string");
  }
  if (path.isAbsolute(relPath)) {
    throw new WorkspaceSecurityError(`absolute paths are not allowed: ${relPath}`);
  }
  const segments = relPath.split(/[\\/]+/);
  if (segments.includes("..")) {
    throw new WorkspaceSecurityError(`path traversal ("..") is not allowed: ${relPath}`);
  }
  if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment))) {
    throw new WorkspaceSecurityError(`path touches a blocked directory: ${relPath}`);
  }
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new WorkspaceSecurityError(`resolved path escapes the workspace: ${relPath}`);
  }
  return resolved;
}

function assertWritable(relPath: string): void {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (PROTECTED_FILES.has(normalized)) {
    throw new WorkspaceSecurityError(`refusing to modify protected file: ${relPath}`);
  }
  if (PROTECTED_DIR_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new WorkspaceSecurityError(`refusing to modify public tests: ${relPath}`);
  }
}

export function listWorkspaceFiles(workspaceRoot: string, relDir = "."): string[] {
  const root = path.resolve(workspaceRoot);
  const startDir = resolveWorkspacePath(workspaceRoot, relDir);
  const out: string[] = [];

  function walk(dir: string): void {
    if (out.length >= MAX_LISTED_FILES) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (BLOCKED_SEGMENTS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
      if (out.length >= MAX_LISTED_FILES) return;
    }
  }

  walk(startDir);
  return out.sort();
}

export function readWorkspaceFile(workspaceRoot: string, relPath: string): string {
  const full = resolveWorkspacePath(workspaceRoot, relPath);
  const stat = fs.statSync(full);
  if (!stat.isFile()) {
    throw new WorkspaceSecurityError(`not a file: ${relPath}`);
  }
  const text = fs.readFileSync(full, "utf8");
  return text.length > MAX_READ_CHARS ? `${text.slice(0, MAX_READ_CHARS)}\n...[truncated]` : text;
}

export function writeWorkspaceFile(workspaceRoot: string, relPath: string, content: string): void {
  assertWritable(relPath);
  const full = resolveWorkspacePath(workspaceRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

export interface RunCommandResult {
  command: string;
  success: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Runs one command, exactly as given, through the sandbox's own `execute()`.
 * Rejects anything not in `allowedCommands` before it ever reaches the
 * runner, and strips the environment down to `commandEnv()` regardless of
 * what the runner would otherwise pass through.
 */
export async function runAllowlistedCommand(
  runner: SandboxRunner,
  sandbox: SandboxHandle,
  command: string,
  allowedCommands: string[],
  timeoutMs: number,
): Promise<RunCommandResult> {
  if (!allowedCommands.includes(command)) {
    throw new WorkspaceSecurityError(
      `command is not on the allowlist for this task: ${command} (allowed: ${allowedCommands.join(", ")})`,
    );
  }
  const [bin, ...args] = command.split(" ").filter(Boolean);
  const result = await runner.execute(sandbox, { command: bin, args, timeoutMs, env: commandEnv() });
  return {
    command,
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    timedOut: Boolean(result.timedOut),
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    durationMs: result.durationMs,
  };
}

export async function gitDiff(runner: SandboxRunner, sandbox: SandboxHandle): Promise<string> {
  const result = await runner.execute(sandbox, { command: "git", args: ["diff", "--no-color"], env: commandEnv() });
  return truncate(result.stdout ?? "", 20_000);
}

export function buildToolDefinitions(allowedCommands: string[]): ToolDefinition[] {
  return [
    {
      name: "list_files",
      description: "List files under a directory in the workspace, relative to the workspace root.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory to list, relative to the workspace root. Defaults to the root." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "read_file",
      description: "Read a text file from the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "File path relative to the workspace root." } },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "write_file",
      description:
        "Overwrite a text file in the workspace. Cannot modify tests/, package.json or tsconfig.json.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the workspace root." },
          content: { type: "string", description: "Full new contents of the file." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
    {
      name: "run_command",
      description: `Run one allowlisted command in the workspace. Allowed commands: ${allowedCommands.join(", ")}`,
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "Must exactly match one of the allowed commands." } },
        required: ["command"],
        additionalProperties: false,
      },
    },
    {
      name: "git_diff",
      description: "Show the current git diff of the workspace against its starting commit.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

export interface ToolExecutorOptions {
  runner: SandboxRunner;
  sandbox: SandboxHandle;
  allowedCommands: string[];
  commandTimeoutMs: number;
}

function requireLocalRoot(sandbox: SandboxHandle): string {
  if (!sandbox.root) {
    throw new WorkspaceSecurityError(
      "this sandbox has no local filesystem view; list_files/read_file/write_file are unsupported by this runner",
    );
  }
  return sandbox.root;
}

/** Wires the tool implementations into a single dispatcher for the agent loop. */
export function createToolExecutor(options: ToolExecutorOptions): ToolExecutor {
  return async (call: ToolCall): Promise<ToolExecutionResult> => {
    try {
      switch (call.name) {
        case "list_files": {
          const relDir = typeof call.arguments.path === "string" ? call.arguments.path : ".";
          const files = listWorkspaceFiles(requireLocalRoot(options.sandbox), relDir);
          return { ok: true, content: files.length > 0 ? files.join("\n") : "(empty directory)" };
        }
        case "read_file": {
          const relPath = call.arguments.path;
          if (typeof relPath !== "string") throw new WorkspaceSecurityError("path must be a string");
          return { ok: true, content: readWorkspaceFile(requireLocalRoot(options.sandbox), relPath) };
        }
        case "write_file": {
          const relPath = call.arguments.path;
          const content = call.arguments.content;
          if (typeof relPath !== "string" || typeof content !== "string") {
            throw new WorkspaceSecurityError("path and content must be strings");
          }
          writeWorkspaceFile(requireLocalRoot(options.sandbox), relPath, content);
          return { ok: true, content: `wrote ${content.length} chars to ${relPath}` };
        }
        case "run_command": {
          const command = call.arguments.command;
          if (typeof command !== "string") throw new WorkspaceSecurityError("command must be a string");
          const result = await runAllowlistedCommand(
            options.runner,
            options.sandbox,
            command,
            options.allowedCommands,
            options.commandTimeoutMs,
          );
          const summary = `exit ${result.exitCode ?? "?"}${result.timedOut ? " (timed out)" : ""}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
          return { ok: result.success, content: summary };
        }
        case "git_diff": {
          const diff = await gitDiff(options.runner, options.sandbox);
          return { ok: true, content: diff.trim() === "" ? "(no changes)" : diff };
        }
        default:
          return { ok: false, content: `unknown tool: ${call.name}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown tool error";
      return { ok: false, content: `error: ${message}` };
    }
  };
}
