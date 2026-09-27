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

test("maps a 401 to auth_failed", async () => {
  const fetchImpl = sequentialFetch([{ status: 401, body: { error: "unauthorized" } }]);
  await assert.rejects(
    () =>
      runCodingAgent({
        instruction: "x",
        toolDefinitions: [],
        executeTool: async () => ({ ok: true, content: "" }),
        maxTurns: 1,
        config,
        fetchImpl,
      }),
    (err: unknown) => {
      assert.ok(err instanceof NebiusError);
      assert.equal(err.code, "auth_failed");
      return true;
    },
  );
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
