import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { createSandboxRunner, InvalidRunnerConfigError, resolveRunnerKind } from "../src/lib/sandbox/runner-config";
import { LocalExperimentRunner } from "../src/lib/experiments/local-runner";
import { SandboxBridgeError, SandboxNotConfiguredError, TokenFactorySandboxRunner } from "../src/lib/sandbox/token-factory-runner";
import type { SandboxHandle } from "../src/lib/sandbox/types";

const FAKE_BRIDGE = ["node", path.join(__dirname, "fixtures", "fake-contree-bridge.mjs")];

function fakeRunner(mode: string, overrides: { bridgeTimeoutMs?: number } = {}) {
  return new TokenFactorySandboxRunner({
    command: FAKE_BRIDGE,
    env: { ...process.env, FAKE_BRIDGE_MODE: mode } as Record<string, string>,
    skipConfigCheck: true,
    ...overrides,
  });
}

// --- runner selection ---------------------------------------------------

test("resolveRunnerKind defaults to local when unset", () => {
  assert.equal(resolveRunnerKind({}), "local");
});

test("resolveRunnerKind accepts local and token-factory", () => {
  assert.equal(resolveRunnerKind({ HARNESSLAB_RUNNER: "local" }), "local");
  assert.equal(resolveRunnerKind({ HARNESSLAB_RUNNER: "token-factory" }), "token-factory");
});

test("resolveRunnerKind rejects an unrecognized value instead of silently defaulting", () => {
  assert.throws(() => resolveRunnerKind({ HARNESSLAB_RUNNER: "remote" }), InvalidRunnerConfigError);
});

test("createSandboxRunner returns the runner matching HARNESSLAB_RUNNER, with no silent fallback", () => {
  assert.ok(createSandboxRunner({ HARNESSLAB_RUNNER: "local" }) instanceof LocalExperimentRunner);
  assert.ok(createSandboxRunner({ HARNESSLAB_RUNNER: "token-factory" }) instanceof TokenFactorySandboxRunner);
});

// --- missing configuration: fails loudly, never falls back --------------

test("TokenFactorySandboxRunner refuses every operation when NEBIUS_API_KEY/NEBIUS_PROJECT_ID are unset", async () => {
  const runner = new TokenFactorySandboxRunner({ command: FAKE_BRIDGE }); // no skipConfigCheck
  const savedKey = process.env.NEBIUS_API_KEY;
  const savedProject = process.env.NEBIUS_PROJECT_ID;
  delete process.env.NEBIUS_API_KEY;
  delete process.env.NEBIUS_PROJECT_ID;
  try {
    const handle: SandboxHandle = { id: "x", checkpoint: "chk" };
    await assert.rejects(() => runner.create({ fixturePath: "fixtures/payment-retry" }), SandboxNotConfiguredError);
    await assert.rejects(() => runner.execute(handle, { command: "true" }), SandboxNotConfiguredError);
    await assert.rejects(() => runner.listFiles(handle, "."), SandboxNotConfiguredError);
    await assert.rejects(() => runner.readFile(handle, "a.ts"), SandboxNotConfiguredError);
    await assert.rejects(() => runner.writeFile(handle, "a.ts", "x"), SandboxNotConfiguredError);
    await assert.rejects(() => runner.destroy(handle), SandboxNotConfiguredError);
  } finally {
    if (savedKey) process.env.NEBIUS_API_KEY = savedKey;
    if (savedProject) process.env.NEBIUS_PROJECT_ID = savedProject;
  }
});

// --- bridge command result mapping ---------------------------------------

test("create() maps the bridge response into a checkpoint-bearing handle", async () => {
  const runner = fakeRunner("ok");
  const handle = await runner.create({ fixturePath: "fixtures/payment-retry", label: "test" });
  assert.equal(handle.checkpoint, "chk-created");
  assert.equal(handle.metadata?.baseImage, "node:22-slim");
});

test("forkFrom() makes no bridge call and hands out an independent handle on the same checkpoint", async () => {
  const runner = fakeRunner("fail"); // if forkFrom called the bridge, this mode would make it throw
  const base = { id: "base", checkpoint: "chk-shared-base", metadata: { baseImage: "node:22-slim" } };

  const forkA = await runner.forkFrom(base, "cell-a");
  const forkB = await runner.forkFrom(base, "cell-b");

  assert.equal(forkA.checkpoint, "chk-shared-base");
  assert.equal(forkB.checkpoint, "chk-shared-base");
  assert.notEqual(forkA.id, forkB.id);
  assert.equal(forkA.metadata?.forkedFrom, "chk-shared-base");
});

test("execute() maps stdout/stderr/exitCode and threads the new checkpoint forward", async () => {
  const runner = fakeRunner("ok");
  const handle: SandboxHandle = { id: "x", checkpoint: "chk-0" };
  const result = await runner.execute(handle, { command: "echo", args: ["hi"] });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello\n");
  assert.equal(handle.checkpoint, "chk-after-exec", "the SAME handle object must be mutated in place");
});

test("readFile/writeFile/listFiles map through the bridge and thread checkpoints forward", async () => {
  const runner = fakeRunner("ok");
  const handle: SandboxHandle = { id: "x", checkpoint: "chk-0" };

  const content = await runner.readFile(handle, "src/a.ts");
  assert.equal(content, "fake file content");

  await runner.writeFile(handle, "src/a.ts", "new content");
  assert.equal(handle.checkpoint, "chk-after-write");

  const files = await runner.listFiles(handle, ".");
  assert.deepEqual(files, ["src/a.ts", "tests/a.test.ts"]);
});

test("destroy() completes without throwing (documented no-op — Contree exposes no delete operation)", async () => {
  const runner = fakeRunner("ok");
  await assert.doesNotReject(() => runner.destroy({ id: "x", checkpoint: "chk-0" }));
});

// --- bridge JSON validation / failure handling ---------------------------

test("invalid JSON from the bridge is reported as a SandboxBridgeError, not thrown as a parse exception", async () => {
  const runner = fakeRunner("invalid-json");
  await assert.rejects(() => runner.create({ fixturePath: "fixtures/payment-retry" }), SandboxBridgeError);
});

test("an { ok: false } bridge response is surfaced as a SandboxBridgeError with the bridge's own message", async () => {
  const runner = fakeRunner("fail");
  await assert.rejects(() => runner.create({ fixturePath: "fixtures/payment-retry" }), (err: unknown) => {
    assert.ok(err instanceof SandboxBridgeError);
    assert.match(err.message, /simulated bridge failure/);
    return true;
  });
});

test("a hung bridge process is killed and reported as a timeout, not left to hang the experiment", async () => {
  const runner = fakeRunner("hang", { bridgeTimeoutMs: 200 });
  await assert.rejects(() => runner.create({ fixturePath: "fixtures/payment-retry" }), (err: unknown) => {
    assert.ok(err instanceof SandboxBridgeError);
    assert.match(err.message, /did not respond within/);
    return true;
  });
});

// --- secret isolation -----------------------------------------------------

test("the bridge process gets NEBIUS_API_KEY/NEBIUS_PROJECT_ID; sandboxed command env does not", async () => {
  const runner = new TokenFactorySandboxRunner({
    command: FAKE_BRIDGE,
    env: { PATH: process.env.PATH ?? "", NEBIUS_API_KEY: "fake-key-for-test", NEBIUS_PROJECT_ID: "fake-project", FAKE_BRIDGE_MODE: "echo-env" },
    skipConfigCheck: true,
  });
  const handle: SandboxHandle = { id: "x", checkpoint: "chk-0" };
  const result = await runner.execute(handle, { command: "true", env: {} }); // env: {} -- exactly what tools.ts's commandEnv() would send (no secrets)
  const echoed = JSON.parse(result.stdout);
  assert.equal(echoed.bridgeProcessHasApiKey, true, "the bridge process itself needs the credential to authenticate");
  assert.equal(echoed.bridgeProcessHasProjectId, true);
  assert.deepEqual(echoed.requestEnvKeys, [], "no key ever goes into the env for code running inside the sandbox");
});

// --- hidden-test separation -------------------------------------------------

test("create() never sends fixture material outside FIXTURE_COPY_ENTRIES (e.g. hidden/) to the bridge", async () => {
  const runner = fakeRunner("echo-files");
  const handle = await runner.create({ fixturePath: "fixtures/payment-retry" });
  const sentPaths: string[] = JSON.parse(handle.checkpoint!);
  assert.ok(sentPaths.length > 0);
  assert.ok(sentPaths.includes("src/paymentRetry.ts"));
  assert.ok(!sentPaths.some((p) => p.startsWith("hidden/")), "hidden/ must never reach the remote sandbox");
});
