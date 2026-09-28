import assert from "node:assert/strict";
import { test } from "node:test";
import { runCodingAgent } from "../src/lib/agent/coding-agent";
import { NebiusError } from "../src/lib/nebius/client";
import type { NebiusConfig } from "../src/lib/nebius/config";
import type { ToolExecutionResult } from "../src/lib/agent/types";

const config: NebiusConfig = {
  apiKey: "sk-test-SECRET",
  baseUrl: "https://example.test/v1",
  model: "test-model",
  timeoutMs: 2000,
};
const HARNESS = { model: "test-model", systemPrompt: "You are a test agent." };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sequentialFetch(bodies: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0;
  return (async () => {
    const entry = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return jsonResponse(entry.status, entry.body);
  }) as typeof fetch;
}

function assistantMessage(content: string | null, toolCalls?: Array<{ id: string; name: string; args: unknown }>) {
  return {
    model: "test-model",
    choices: [
      {
        message: {
          role: "assistant",
          content,
          ...(toolCalls
            ? {
                tool_calls: toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: JSON.stringify(call.args) },
                })),
              }
            : {}),
        },
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

test("completes in one turn when the model calls no tools", async () => {
  const fetchImpl = sequentialFetch([{ status: 200, body: assistantMessage("All done.") }]);
  const trajectory = await runCodingAgent({
    ...HARNESS,
    instruction: "do nothing",
    toolDefinitions: [],
    executeTool: async () => {
      throw new Error("should not be called");
    },
    maxTurns: 3,
    config,
    fetchImpl,
  });

  assert.equal(trajectory.stopReason, "completed");
  assert.equal(trajectory.turns.length, 1);
  assert.equal(trajectory.toolCallCount, 0);
  assert.equal(trajectory.finalAssistantMessage, "All done.");
});

test("executes a requested tool and records the result before finishing", async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const fetchImpl = sequentialFetch([
    { status: 200, body: assistantMessage(null, [{ id: "call_1", name: "read_file", args: { path: "src/x.ts" } }]) },
    { status: 200, body: assistantMessage("Done reading.") },
  ]);

  const trajectory = await runCodingAgent({
    ...HARNESS,
    instruction: "read a file",
    toolDefinitions: [],
    executeTool: async (call): Promise<ToolExecutionResult> => {
      calls.push(call);
      return { ok: true, content: "file contents" };
    },
    maxTurns: 5,
    config,
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "read_file");
  assert.equal(trajectory.turns.length, 2);
  assert.equal(trajectory.toolCallCount, 1);
  assert.equal(trajectory.turns[0].toolCalls[0].ok, true);
  assert.equal(trajectory.stopReason, "completed");
  assert.equal(trajectory.finalAssistantMessage, "Done reading.");
  assert.equal(trajectory.totalUsage.totalTokens, 4);
});

test("stops at maxTurns when the model keeps requesting tools", async () => {
  const fetchImpl = (async () =>
    jsonResponse(200, assistantMessage(null, [{ id: "call_x", name: "run_command", args: { command: "npm test" } }]))) as typeof fetch;

  const trajectory = await runCodingAgent({
    ...HARNESS,
    instruction: "loop forever",
    toolDefinitions: [],
    executeTool: async () => ({ ok: true, content: "exit 0" }),
    maxTurns: 2,
    config,
    fetchImpl,
  });

  assert.equal(trajectory.turns.length, 2);
  assert.equal(trajectory.stopReason, "max_turns");
});

test("a 401 ends the loop gracefully with provider_error, not a thrown exception", async () => {
  // A single bad request must not crash a whole factorial/comparison batch — it should
  // resolve with a trajectory that explains what happened, so the other cells can still run.
  const fetchImpl = sequentialFetch([{ status: 401, body: { error: "unauthorized" } }]);
  const trajectory = await runCodingAgent({
    ...HARNESS,
    instruction: "x",
    toolDefinitions: [],
    executeTool: async () => ({ ok: true, content: "" }),
    maxTurns: 1,
    config,
    fetchImpl,
  });

  assert.equal(trajectory.stopReason, "provider_error");
  assert.match(trajectory.terminationDetail ?? "", /401/);
  assert.equal(trajectory.turns.length, 0);
});

test("missing config still throws synchronously (setup failure, not a per-turn outcome)", async () => {
  await assert.rejects(
    () =>
      runCodingAgent({
        ...HARNESS,
        instruction: "x",
        toolDefinitions: [],
        executeTool: async () => ({ ok: true, content: "" }),
        maxTurns: 1,
        config: undefined,
        fetchImpl: sequentialFetch([{ status: 200, body: assistantMessage("unused") }]),
      }),
    (err: unknown) => {
      assert.ok(err instanceof NebiusError);
      assert.equal(err.code, "config_missing");
      return true;
    },
  );
});

test("an executor that throws unexpectedly ends the loop gracefully with tool_error", async () => {
  const fetchImpl = sequentialFetch([
    { status: 200, body: assistantMessage(null, [{ id: "call_1", name: "run_command", args: { command: "npm test" } }]) },
  ]);

  const trajectory = await runCodingAgent({
    ...HARNESS,
    instruction: "run tests",
    toolDefinitions: [],
    executeTool: async () => {
      throw new Error("executor blew up");
    },
    maxTurns: 3,
    config,
    fetchImpl,
  });

  assert.equal(trajectory.stopReason, "tool_error");
  assert.equal(trajectory.terminationDetail, "executor blew up");
  assert.equal(trajectory.turns.length, 0);
});

test("truncates a large write_file content argument in the recorded trajectory", async () => {
  const bigContent = "x".repeat(500);
  const fetchImpl = sequentialFetch([
    {
      status: 200,
      body: assistantMessage(null, [{ id: "call_1", name: "write_file", args: { path: "src/x.ts", content: bigContent } }]),
    },
    { status: 200, body: assistantMessage("wrote it") },
  ]);

  const trajectory = await runCodingAgent({
    ...HARNESS,
    instruction: "write a file",
    toolDefinitions: [],
    executeTool: async () => ({ ok: true, content: "wrote 500 chars" }),
    maxTurns: 3,
    config,
    fetchImpl,
  });

  const recordedContent = trajectory.turns[0].toolCalls[0].arguments.content as string;
  assert.ok(recordedContent.length < bigContent.length);
  assert.match(recordedContent, /\[500 chars total\]/);
});

test("records per-request message count and serialized size, growing as the conversation grows", async () => {
  const fetchImpl = sequentialFetch([
    { status: 200, body: assistantMessage(null, [{ id: "call_1", name: "read_file", args: { path: "src/x.ts" } }]) },
    { status: 200, body: assistantMessage(null, [{ id: "call_2", name: "read_file", args: { path: "src/y.ts" } }]) },
    { status: 200, body: assistantMessage("done") },
  ]);

  const trajectory = await runCodingAgent({
    ...HARNESS,
    instruction: "read two files",
    toolDefinitions: [],
    executeTool: async () => ({ ok: true, content: "some file content" }),
    maxTurns: 5,
    config,
    fetchImpl,
  });

  assert.equal(trajectory.turns.length, 3);
  const messageCounts = trajectory.turns.map((t) => t.request.messageCount);
  const sizes = trajectory.turns.map((t) => t.request.serializedSizeChars);
  // Turn 1 sends [system, user]; turn 2 adds the turn-1 assistant+tool messages; turn 3 adds turn-2's.
  assert.deepEqual(messageCounts, [2, 4, 6]);
  assert.ok(sizes[1] > sizes[0], "serialized request size should grow as history accumulates");
  assert.ok(sizes[2] > sizes[1], "serialized request size should keep growing");
  for (const turn of trajectory.turns) {
    for (const call of turn.toolCalls) {
      assert.equal(call.resultChars, "some file content".length);
    }
  }
});
