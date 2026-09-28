import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { diffChangedFiles, wasCommandExecuted } from "../src/lib/experiments/evaluator";
import { LocalExperimentRunner } from "../src/lib/experiments/local-runner";
import type { AgentTrajectory } from "../src/lib/agent/types";
import type { SandboxHandle } from "../src/lib/sandbox/types";

const runner = new LocalExperimentRunner();

function makeDir(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnesslab-eval-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/** diffChangedFiles reads "after" through the runner (works for local or remote); "before" is always local disk. */
function handleFor(root: string): SandboxHandle {
  return { id: "test", root };
}

test("diffChangedFiles reports modified, added and removed files", async () => {
  const before = makeDir({
    "src/a.ts": "export const a = 1;\n",
    "src/unchanged.ts": "export const u = 1;\n",
    "src/removed.ts": "export const r = 1;\n",
  });
  const after = makeDir({
    "src/a.ts": "export const a = 2;\n",
    "src/unchanged.ts": "export const u = 1;\n",
    "src/added.ts": "export const n = 1;\n",
  });

  const changed = await diffChangedFiles(runner, handleFor(after), before);
  assert.deepEqual(changed, ["src/a.ts", "src/added.ts", "src/removed.ts"]);
});

test("diffChangedFiles reports no changes for identical trees", async () => {
  const before = makeDir({ "src/a.ts": "same\n" });
  const after = makeDir({ "src/a.ts": "same\n" });
  assert.deepEqual(await diffChangedFiles(runner, handleFor(after), before), []);
});

test("diffChangedFiles ignores fixture material outside the copied scope (e.g. hidden/)", async () => {
  // Regression test: hidden/ exists in the fixture but is deliberately never
  // copied into a workspace. It must not show up as a "removed" file.
  const before = makeDir({
    "src/a.ts": "same\n",
    "hidden/secret.test.ts": "// evaluator-only\n",
    "README.md": "not copied either\n",
  });
  const after = makeDir({ "src/a.ts": "same\n" });
  assert.deepEqual(await diffChangedFiles(runner, handleFor(after), before), []);
});

function trajectoryWithCommands(commands: string[]): AgentTrajectory {
  return {
    turns: [
      {
        turn: 1,
        model: "test-model",
        assistantContent: null,
        toolCalls: commands.map((command, i) => ({
          id: `call_${i}`,
          name: "run_command",
          arguments: { command },
          ok: true,
          resultSummary: "ok",
          resultChars: 2,
        })),
        startedAt: new Date().toISOString(),
        durationMs: 1,
        usage: null,
        request: { messageCount: 2, serializedSizeChars: 100 },
      },
    ],
    toolCallCount: commands.length,
    stopReason: "completed",
    terminationDetail: null,
    finalAssistantMessage: "done",
    totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}

test("wasCommandExecuted finds an exact run_command match across the trajectory", () => {
  const trajectory = trajectoryWithCommands(["npm run build", "npm test"]);
  assert.equal(wasCommandExecuted(trajectory, "npm test"), true);
  assert.equal(wasCommandExecuted(trajectory, "npm run lint"), false);
});

test("wasCommandExecuted returns false when no commands were run", () => {
  const trajectory = trajectoryWithCommands([]);
  assert.equal(wasCommandExecuted(trajectory, "npm test"), false);
});
