import "server-only";

import { createHash } from "node:crypto";
import type { SandboxHandle, SandboxRunner } from "../sandbox/types";
import { assertSafeRelativePath, assertWritablePath, WorkspaceSecurityError } from "./workspace-security";
import type { ToolCall, ToolDefinition, ToolExecutionResult, ToolExecutor } from "./types";

export { WorkspaceSecurityError } from "./workspace-security";

/**
 * The coding agent's only access to the outside world. Path/write policy is
 * enforced here (once, for every runner) via workspace-security.ts; actual
 * I/O is delegated to whichever SandboxRunner is active (local temp
 * directory or a remote Token Factory Sandbox) — this module never touches
 * a filesystem directly.
 */

const MAX_READ_CHARS = 40_000;
// Real Milestone 1 telemetry showed command output (verbose TAP test/build
// logs) re-billed on every subsequent turn once it entered the conversation
// history. 1500 chars is still enough to see pass/fail and the first
// failure's detail; it isn't sized for dumping every subtest's full output.
const MAX_TOOL_OUTPUT_CHARS = 1_500;
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
  return truncate(result.stdout ?? "");
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

/** Wires the tool implementations into a single dispatcher for the agent loop. */
export function createToolExecutor(options: ToolExecutorOptions): ToolExecutor {
  // Per-run state: if the agent re-reads a file whose content hasn't changed
  // since the last time we returned it, don't pay to resend it verbatim —
  // it's already sitting in the conversation history from the first read.
  const lastReadHash = new Map<string, string>();

  return async (call: ToolCall): Promise<ToolExecutionResult> => {
    try {
      switch (call.name) {
        case "list_files": {
          const relDir = typeof call.arguments.path === "string" ? call.arguments.path : ".";
          assertSafeRelativePath(relDir);
          const files = (await options.runner.listFiles(options.sandbox, relDir)).slice(0, MAX_LISTED_FILES).sort();
          return { ok: true, content: files.length > 0 ? files.join("\n") : "(empty directory)" };
        }
        case "read_file": {
          const relPath = call.arguments.path;
          if (typeof relPath !== "string") throw new WorkspaceSecurityError("path must be a string");
          assertSafeRelativePath(relPath);
          const raw = await options.runner.readFile(options.sandbox, relPath);
          const content = raw.length > MAX_READ_CHARS ? `${raw.slice(0, MAX_READ_CHARS)}\n...[truncated]` : raw;
          const hash = createHash("sha256").update(content).digest("hex");
          if (lastReadHash.get(relPath) === hash) {
            return {
              ok: true,
              content: `(unchanged since your last read of ${relPath} — content is identical to what you already have)`,
            };
          }
          lastReadHash.set(relPath, hash);
          return { ok: true, content };
        }
        case "write_file": {
          const relPath = call.arguments.path;
          const content = call.arguments.content;
          if (typeof relPath !== "string" || typeof content !== "string") {
            throw new WorkspaceSecurityError("path and content must be strings");
          }
          assertSafeRelativePath(relPath);
          assertWritablePath(relPath);
          await options.runner.writeFile(options.sandbox, relPath, content);
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
