import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createToolExecutor, runAllowlistedCommand } from "../src/lib/agent/tools";
import { assertSafeRelativePath, assertWritablePath, WorkspaceSecurityError } from "../src/lib/agent/workspace-security";
import { LocalExperimentRunner } from "../src/lib/experiments/local-runner";
import type { SandboxHandle } from "../src/lib/sandbox/types";

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

// LocalExperimentRunner is used directly as the test SandboxRunner here (rather than a
// hand-rolled fake) — its file/execute methods are already covered by local-runner.test.ts,
// so reusing it keeps these tests exercising the real runner-agnostic tool-executor contract.
const runner = new LocalExperimentRunner();

test("assertSafeRelativePath rejects absolute paths, traversal and blocked directories", () => {
  assert.throws(() => assertSafeRelativePath("/etc/passwd"), WorkspaceSecurityError);
  assert.throws(() => assertSafeRelativePath("../outside.txt"), WorkspaceSecurityError);
  assert.throws(() => assertSafeRelativePath("src/../../outside.txt"), WorkspaceSecurityError);
  assert.throws(() => assertSafeRelativePath("node_modules/x"), WorkspaceSecurityError);
  assert.throws(() => assertSafeRelativePath(".git/HEAD"), WorkspaceSecurityError);
  assert.doesNotThrow(() => assertSafeRelativePath("src/a.ts"));
  assert.doesNotThrow(() => assertSafeRelativePath("."));
});

test("assertWritablePath refuses protected files and public tests", () => {
  assert.throws(() => assertWritablePath("package.json"), WorkspaceSecurityError);
  assert.throws(() => assertWritablePath("tsconfig.json"), WorkspaceSecurityError);
  assert.throws(() => assertWritablePath("tests/a.test.ts"), WorkspaceSecurityError);
  assert.doesNotThrow(() => assertWritablePath("src/a.ts"));
});

test("runAllowlistedCommand rejects a command not on the allowlist", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t1", root };
  await assert.rejects(
    () => runAllowlistedCommand(runner, sandbox, "rm -rf /", ["npm test"], 5000),
    WorkspaceSecurityError,
  );
});

test("runAllowlistedCommand runs an exact allowlisted command and captures output", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t2", root };
  const result = await runAllowlistedCommand(runner, sandbox, "echo hello-harnesslab", ["echo hello-harnesslab"], 5000);
  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /hello-harnesslab/);
});

test("createToolExecutor: write_file to a protected path is reported as a failed tool call, not thrown", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t3", root };
  const executeTool = createToolExecutor({ runner, sandbox, allowedCommands: ["echo ok"], commandTimeoutMs: 5000 });
  const result = await executeTool({ name: "write_file", arguments: { path: "tests/a.test.ts", content: "cheat" } });
  assert.equal(result.ok, false);
  assert.match(result.content, /protected|public tests/);
});

test("createToolExecutor: read_file and list_files work through the dispatcher", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t4", root };
  const executeTool = createToolExecutor({ runner, sandbox, allowedCommands: ["echo ok"], commandTimeoutMs: 5000 });
  const listing = await executeTool({ name: "list_files", arguments: {} });
  assert.ok(listing.ok);
  assert.match(listing.content, /src\/a\.ts/);
  assert.ok(!listing.content.includes("node_modules/"));

  const read = await executeTool({ name: "read_file", arguments: { path: "src/a.ts" } });
  assert.ok(read.ok);
  assert.equal(read.content, "export const a = 1;\n");
});

test("createToolExecutor: run_command rejects commands outside the task allowlist", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t5", root };
  const executeTool = createToolExecutor({ runner, sandbox, allowedCommands: ["echo ok"], commandTimeoutMs: 5000 });
  const result = await executeTool({ name: "run_command", arguments: { command: "echo not-allowed" } });
  assert.equal(result.ok, false);
  assert.match(result.content, /not on the allowlist/);
});

test("run_command output is capped so verbose command output doesn't compound turn over turn", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t6", root };
  const bigOutputCommand = "node -e console.log('x'.repeat(5000))";
  const result = await runAllowlistedCommand(runner, sandbox, bigOutputCommand, [bigOutputCommand], 5000);
  assert.ok(result.stdout.length < 2000, `expected truncated output, got ${result.stdout.length} chars`);
  assert.match(result.stdout, /truncated/);
});

test("run_command output under the cap is returned untouched", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t7", root };
  const result = await runAllowlistedCommand(runner, sandbox, "echo short", ["echo short"], 5000);
  assert.doesNotMatch(result.stdout, /truncated/);
});

test("createToolExecutor: re-reading an unchanged file returns a short marker instead of the full content again", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t8", root };
  const executeTool = createToolExecutor({ runner, sandbox, allowedCommands: [], commandTimeoutMs: 5000 });

  const first = await executeTool({ name: "read_file", arguments: { path: "src/a.ts" } });
  assert.equal(first.content, "export const a = 1;\n");

  const second = await executeTool({ name: "read_file", arguments: { path: "src/a.ts" } });
  assert.match(second.content, /unchanged since your last read/);
  assert.notEqual(second.content, first.content);
});

test("createToolExecutor: a write invalidates the dedup — the next read returns fresh content", async () => {
  const root = makeWorkspace();
  const sandbox: SandboxHandle = { id: "t9", root };
  const executeTool = createToolExecutor({ runner, sandbox, allowedCommands: [], commandTimeoutMs: 5000 });

  await executeTool({ name: "read_file", arguments: { path: "src/a.ts" } });
  await executeTool({ name: "write_file", arguments: { path: "src/a.ts", content: "export const a = 2;\n" } });
  const afterWrite = await executeTool({ name: "read_file", arguments: { path: "src/a.ts" } });
  assert.equal(afterWrite.content, "export const a = 2;\n");
});
