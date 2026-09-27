import assert from "node:assert/strict";
import { execFile, type ExecFileException } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createToolExecutor,
  listWorkspaceFiles,
  readWorkspaceFile,
  resolveWorkspacePath,
  runAllowlistedCommand,
  WorkspaceSecurityError,
  writeWorkspaceFile,
} from "../src/lib/agent/tools";
import type { SandboxCommand, SandboxExecResult, SandboxHandle, SandboxRunner } from "../src/lib/sandbox/types";

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnesslab-tools-test-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", "some-pkg"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(root, "tests", "a.test.ts"), "// public test\n");
  fs.writeFileSync(path.join(root, "node_modules", "some-pkg", "index.js"), "module.exports = {};\n");
  fs.writeFileSync(path.join(root, "package.json"), "{}\n");
  return root;
}

/** Minimal real SandboxRunner for testing run_command / the tool executor, independent of LocalExperimentRunner. */
const testRunner: SandboxRunner = {
  create(): Promise<SandboxHandle> {
    throw new Error("not used in this test");
  },
  execute(sandbox: SandboxHandle, command: SandboxCommand): Promise<SandboxExecResult> {
    const started = Date.now();
    return new Promise((resolve) => {
      execFile(
        command.command,
        command.args ?? [],
        { cwd: command.cwd ?? sandbox.root, timeout: command.timeoutMs, env: (command.env ?? {}) as NodeJS.ProcessEnv },
        (error: ExecFileException | null, stdout: string, stderr: string) => {
          resolve({
            exitCode: !error ? 0 : typeof error.code === "number" ? error.code : -1,
            stdout,
            stderr,
            durationMs: Date.now() - started,
          });
        },
      );
    });
  },
  async destroy(): Promise<void> {},
};

test("resolveWorkspacePath rejects absolute paths and traversal", () => {
  const root = makeWorkspace();
  assert.throws(() => resolveWorkspacePath(root, "/etc/passwd"), WorkspaceSecurityError);
  assert.throws(() => resolveWorkspacePath(root, "../outside.txt"), WorkspaceSecurityError);
  assert.throws(() => resolveWorkspacePath(root, "src/../../outside.txt"), WorkspaceSecurityError);
  assert.throws(() => resolveWorkspacePath(root, "node_modules/x"), WorkspaceSecurityError);
  const resolved = resolveWorkspacePath(root, "src/a.ts");
  assert.equal(resolved, path.join(root, "src", "a.ts"));
});

test("writeWorkspaceFile refuses to modify protected files and public tests", () => {
  const root = makeWorkspace();
  assert.throws(() => writeWorkspaceFile(root, "package.json", "{}"), WorkspaceSecurityError);
  assert.throws(() => writeWorkspaceFile(root, "tsconfig.json", "{}"), WorkspaceSecurityError);
  assert.throws(() => writeWorkspaceFile(root, "tests/a.test.ts", "cheat"), WorkspaceSecurityError);
  writeWorkspaceFile(root, "src/a.ts", "export const a = 2;\n");
  assert.equal(readWorkspaceFile(root, "src/a.ts"), "export const a = 2;\n");
});

test("writeWorkspaceFile creates intermediate directories within the workspace", () => {
  const root = makeWorkspace();
  writeWorkspaceFile(root, "src/nested/b.ts", "export const b = 1;\n");
  assert.equal(readWorkspaceFile(root, "src/nested/b.ts"), "export const b = 1;\n");
});

test("listWorkspaceFiles excludes node_modules and .git", () => {
  const root = makeWorkspace();
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const files = listWorkspaceFiles(root);
  assert.ok(files.includes("src/a.ts"));
  assert.ok(!files.some((f) => f.startsWith("node_modules/")));
  assert.ok(!files.some((f) => f.startsWith(".git/")));
});

test("runAllowlistedCommand rejects a command not on the allowlist", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t1", root };
  await assert.rejects(
    () => runAllowlistedCommand(testRunner, sandbox, "rm -rf /", ["npm test"], 5000),
    WorkspaceSecurityError,
  );
});

test("runAllowlistedCommand runs an exact allowlisted command and captures output", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t2", root };
  const result = await runAllowlistedCommand(testRunner, sandbox, "echo hello-harnesslab", ["echo hello-harnesslab"], 5000);
  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /hello-harnesslab/);
});

test("createToolExecutor: write_file to a protected path is reported as a failed tool call, not thrown", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t3", root };
  const executeTool = createToolExecutor({
    runner: testRunner,
    sandbox,
    allowedCommands: ["echo ok"],
    commandTimeoutMs: 5000,
  });
  const result = await executeTool({ name: "write_file", arguments: { path: "tests/a.test.ts", content: "cheat" } });
  assert.equal(result.ok, false);
  assert.match(result.content, /protected|public tests/);
});

test("createToolExecutor: read_file and list_files work through the dispatcher", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t4", root };
  const executeTool = createToolExecutor({
    runner: testRunner,
    sandbox,
    allowedCommands: ["echo ok"],
    commandTimeoutMs: 5000,
  });
  const listing = await executeTool({ name: "list_files", arguments: {} });
  assert.ok(listing.ok);
  assert.match(listing.content, /src\/a\.ts/);

  const read = await executeTool({ name: "read_file", arguments: { path: "src/a.ts" } });
  assert.ok(read.ok);
  assert.equal(read.content, "export const a = 1;\n");
});

test("createToolExecutor: run_command rejects commands outside the task allowlist", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t5", root };
  const executeTool = createToolExecutor({
    runner: testRunner,
    sandbox,
    allowedCommands: ["echo ok"],
    commandTimeoutMs: 5000,
  });
  const result = await executeTool({ name: "run_command", arguments: { command: "echo not-allowed" } });
  assert.equal(result.ok, false);
  assert.match(result.content, /not on the allowlist/);
});
