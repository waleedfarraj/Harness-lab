import assert from "node:assert/strict";
import { test } from "node:test";
import { applyContextPolicy } from "../src/lib/agent/coding-agent";

function bigContent(label: string, chars = 2000): string {
  return `${label}:` + "x".repeat(chars);
}

test("applyContextPolicy is a no-op under the full policy, regardless of size", () => {
  const messages = [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "task" },
    { role: "assistant" as const, content: null },
    { role: "tool" as const, content: bigContent("read_file", 5000) },
  ];
  const messageMeta = [null, null, null, { toolName: "read_file", identifier: "src/a.ts", originalChars: 5006, compacted: false }];

  const events = applyContextPolicy(messages, messageMeta, "full");

  assert.deepEqual(events, []);
  assert.equal(messages[3].content, bigContent("read_file", 5000));
});

test("applyContextPolicy under compact does nothing below the size trigger", () => {
  const messages = [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "task" },
    { role: "tool" as const, content: "short result" },
  ];
  const messageMeta = [null, null, { toolName: "read_file", identifier: "src/a.ts", originalChars: 12, compacted: false }];

  const events = applyContextPolicy(messages, messageMeta, "compact");

  assert.deepEqual(events, []);
  assert.equal(messages[2].content, "short result");
});

test("applyContextPolicy under compact replaces older tool results once the size trigger is crossed, keeping the most recent ones verbatim", () => {
  const messages = [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "task" },
    { role: "tool" as const, content: bigContent("read_file_1", 1500) }, // oldest -> should compact
    { role: "tool" as const, content: bigContent("read_file_2", 1500) }, // second-oldest -> should compact
    { role: "tool" as const, content: bigContent("run_command", 800) }, // kept (most recent 2)
    { role: "tool" as const, content: bigContent("git_diff", 800) }, // kept (most recent 2)
  ];
  const messageMeta = [
    null,
    null,
    { toolName: "read_file", identifier: "src/a.ts", originalChars: messages[2].content.length, compacted: false },
    { toolName: "read_file", identifier: "src/b.ts", originalChars: messages[3].content.length, compacted: false },
    { toolName: "run_command", identifier: "npm test", originalChars: messages[4].content.length, compacted: false },
    { toolName: "git_diff", identifier: "git_diff", originalChars: messages[5].content.length, compacted: false },
  ];

  const events = applyContextPolicy(messages, messageMeta, "compact");

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => e.identifier),
    ["src/a.ts", "src/b.ts"],
  );
  assert.match(messages[2].content!, /^\[compacted read_file result for src\/a\.ts: \d+ chars omitted\]$/);
  assert.match(messages[3].content!, /^\[compacted read_file result for src\/b\.ts: \d+ chars omitted\]$/);
  // the two most recent tool results stay verbatim
  assert.equal(messages[4].content, bigContent("run_command", 800));
  assert.equal(messages[5].content, bigContent("git_diff", 800));
});

test("applyContextPolicy never touches the system message or the task (user) message", () => {
  const systemContent = "system prompt + skill content, must never change";
  const taskContent = "the task instruction, must never change";
  const messages = [
    { role: "system" as const, content: systemContent },
    { role: "user" as const, content: taskContent },
    { role: "tool" as const, content: bigContent("read_file_1", 2000) },
    { role: "tool" as const, content: bigContent("read_file_2", 2000) },
    { role: "tool" as const, content: bigContent("read_file_3", 2000) },
  ];
  const messageMeta = [
    null,
    null,
    { toolName: "read_file", identifier: "a.ts", originalChars: messages[2].content.length, compacted: false },
    { toolName: "read_file", identifier: "b.ts", originalChars: messages[3].content.length, compacted: false },
    { toolName: "read_file", identifier: "c.ts", originalChars: messages[4].content.length, compacted: false },
  ];

  applyContextPolicy(messages, messageMeta, "compact");

  assert.equal(messages[0].content, systemContent);
  assert.equal(messages[1].content, taskContent);
});

test("applyContextPolicy never re-expands an already-compacted result on a later call", () => {
  const messages = [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "task" },
    { role: "tool" as const, content: bigContent("read_file_1", 2000) },
    { role: "tool" as const, content: bigContent("read_file_2", 2000) },
    { role: "tool" as const, content: bigContent("read_file_3", 2000) },
  ];
  const messageMeta = [
    null,
    null,
    { toolName: "read_file", identifier: "a.ts", originalChars: messages[2].content.length, compacted: false },
    { toolName: "read_file", identifier: "b.ts", originalChars: messages[3].content.length, compacted: false },
    { toolName: "read_file", identifier: "c.ts", originalChars: messages[4].content.length, compacted: false },
  ];

  const firstPass = applyContextPolicy(messages, messageMeta, "compact");
  const compactedContent = messages[2].content;
  const secondPass = applyContextPolicy(messages, messageMeta, "compact");

  assert.equal(firstPass.length, 1, "the one result older than the 2 most recent compacts on the first pass");
  assert.deepEqual(secondPass, [], "nothing new to compact on a repeat call");
  assert.equal(messages[2].content, compactedContent, "already-compacted content is not re-summarized or expanded");
});
