import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { LocalExperimentRunner } from "../src/lib/experiments/local-runner";

const FIXTURE_PATH = "fixtures/payment-retry";

test("create() seeds a fresh workspace from the fixture, excluding hidden/, with git and node_modules set up", async () => {
  const runner = new LocalExperimentRunner();
  const sandbox = await runner.create({ label: "test", fixturePath: FIXTURE_PATH });
  try {
    assert.ok(sandbox.root, "expected a local root");
    const root = sandbox.root!;
    assert.ok(fs.existsSync(`${root}/package.json`));
    assert.ok(fs.existsSync(`${root}/tsconfig.json`));
    assert.ok(fs.existsSync(`${root}/src/paymentRetry.ts`));
    assert.ok(fs.existsSync(`${root}/tests/paymentRetry.test.ts`));
    assert.ok(!fs.existsSync(`${root}/hidden`), "hidden/ must not be copied into the agent's workspace");

    const nodeModulesStat = fs.lstatSync(`${root}/node_modules`);
    assert.ok(nodeModulesStat.isSymbolicLink(), "node_modules should be a symlink, not a copy");

    assert.ok(fs.existsSync(`${root}/.git`), "workspace should be a fresh git repo for diff evidence");
  } finally {
    await runner.destroy(sandbox);
  }
});

test("two workspaces from the same fixture are independent (mutating one does not affect the other)", async () => {
  const runner = new LocalExperimentRunner();
  const a = await runner.create({ label: "a", fixturePath: FIXTURE_PATH });
  const b = await runner.create({ label: "b", fixturePath: FIXTURE_PATH });
  try {
    fs.writeFileSync(`${a.root}/src/paymentRetry.ts`, "// mutated\n");
    const bContent = fs.readFileSync(`${b.root}/src/paymentRetry.ts`, "utf8");
    assert.notEqual(bContent, "// mutated\n");
  } finally {
    await runner.destroy(a);
    await runner.destroy(b);
  }
});

test("execute() runs a command with the workspace as cwd and reports exit code/output", async () => {
  const runner = new LocalExperimentRunner();
  const sandbox = await runner.create({ label: "exec", fixturePath: FIXTURE_PATH });
  try {
    const ok = await runner.execute(sandbox, { command: "node", args: ["-e", "console.log(1 + 1)"] });
    assert.equal(ok.exitCode, 0);
    assert.equal(ok.stdout.trim(), "2");

    const pwdCheck = await runner.execute(sandbox, { command: "node", args: ["-e", "console.log(process.cwd())"] });
    // Compare real paths: on macOS, os.tmpdir() is under a symlink (/var -> /private/var)
    // that the child process's cwd resolves through.
    assert.equal(fs.realpathSync(pwdCheck.stdout.trim()), fs.realpathSync(sandbox.root!));

    const failing = await runner.execute(sandbox, { command: "node", args: ["-e", "process.exit(3)"] });
    assert.equal(failing.exitCode, 3);
  } finally {
    await runner.destroy(sandbox);
  }
});

test("destroy() removes the workspace directory", async () => {
  const runner = new LocalExperimentRunner();
  const sandbox = await runner.create({ label: "destroy", fixturePath: FIXTURE_PATH });
  assert.ok(fs.existsSync(sandbox.root!));
  await runner.destroy(sandbox);
  assert.ok(!fs.existsSync(sandbox.root!));
});
