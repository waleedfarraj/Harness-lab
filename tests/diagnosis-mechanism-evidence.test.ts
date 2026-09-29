import assert from "node:assert/strict";
import { test } from "node:test";
import { detectFixedMechanisms } from "../src/lib/diagnosis/mechanism-evidence";
import type { AgentToolCallRecord, AgentTrajectory, AgentTurnRecord } from "../src/lib/agent/types";

function toolCall(name: string, resultSummary: string): AgentToolCallRecord {
  return { id: name, name, arguments: {}, ok: true, resultSummary, resultChars: resultSummary.length };
}

function turn(toolCalls: AgentToolCallRecord[], newCompactionEvents: AgentTurnRecord["request"]["newCompactionEvents"] = []): AgentTurnRecord {
  return {
    turn: 1,
    model: "test",
    assistantContent: null,
    toolCalls,
    startedAt: new Date().toISOString(),
    durationMs: 1,
    usage: null,
    request: { messageCount: 2, serializedSizeChars: 10, contextPolicy: "compact", preservedToolResultIdentifiers: [], compactedToolResultIdentifiers: [], newCompactionEvents },
  };
}

function trajectory(turns: AgentTurnRecord[], stopReason: AgentTrajectory["stopReason"] = "completed"): AgentTrajectory {
  return { turns, toolCallCount: turns.reduce((n, t) => n + t.toolCalls.length, 0), stopReason, terminationDetail: null, finalAssistantMessage: null, totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
}

test("detectFixedMechanisms finds no mechanisms in a clean, successful trajectory", () => {
  const t = trajectory([turn([toolCall("read_file", "some file content")])], "completed");
  assert.deepEqual(detectFixedMechanisms(t), []);
});

test("detectFixedMechanisms detects read-file dedup markers", () => {
  const t = trajectory([turn([toolCall("read_file", "(unchanged since your last read of src/a.ts — content is identical to what you already have)")])]);
  const mechanisms = detectFixedMechanisms(t);
  assert.ok(mechanisms.some((m) => m.includes("dedup")));
});

test("detectFixedMechanisms detects context-compaction events", () => {
  const t = trajectory([turn([toolCall("read_file", "x")], [{ toolName: "read_file", identifier: "src/a.ts", originalChars: 500, compactedChars: 40 }])]);
  const mechanisms = detectFixedMechanisms(t);
  assert.ok(mechanisms.some((m) => m.includes("compaction")));
});

test("detectFixedMechanisms detects max_turns exhaustion with no write_file ever called", () => {
  const t = trajectory([turn([toolCall("read_file", "x")]), turn([toolCall("read_file", "y")])], "max_turns");
  const mechanisms = detectFixedMechanisms(t);
  assert.ok(mechanisms.some((m) => m.includes("write_file")));
});

test("detectFixedMechanisms does not report max_turns exhaustion when write_file was actually called", () => {
  const t = trajectory([turn([toolCall("write_file", "wrote it")])], "max_turns");
  const mechanisms = detectFixedMechanisms(t);
  assert.ok(!mechanisms.some((m) => m.includes("write_file")));
});

test("detectFixedMechanisms can report multiple mechanisms at once, matching Milestone 4's real failure", () => {
  const t = trajectory(
    [
      turn([toolCall("read_file", "x")], [{ toolName: "read_file", identifier: "src/contract.ts", originalChars: 663, compactedChars: 75 }]),
      turn([toolCall("read_file", "(unchanged since your last read of src/contract.ts — content is identical to what you already have)")]),
    ],
    "max_turns",
  );
  const mechanisms = detectFixedMechanisms(t);
  assert.equal(mechanisms.length, 3);
});
