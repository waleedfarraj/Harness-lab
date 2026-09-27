import assert from "node:assert/strict";
import { test } from "node:test";
import { SandboxNotConfiguredError, TokenFactorySandboxRunner } from "../src/lib/sandbox/token-factory-runner";
import type { SandboxRunner } from "../src/lib/sandbox/types";

test("placeholder sandbox runner refuses every operation", async () => {
  const runner: SandboxRunner = new TokenFactorySandboxRunner();
  const handle = { id: "none" };
  for (const op of [
    () => runner.create(),
    () => runner.execute(handle, { command: "true" }),
    () => runner.destroy(handle),
  ]) {
    await assert.rejects(op, (err: unknown) => {
      assert.ok(err instanceof SandboxNotConfiguredError);
      assert.match(err.message, /Token Factory Sandbox access not configured/);
      return true;
    });
  }
});
