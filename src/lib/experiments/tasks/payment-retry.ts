import "server-only";

import fs from "node:fs";
import path from "node:path";
import { diffChangedFiles, runCheckCommand, wasCommandExecuted } from "../evaluator";
import type { CodingTask } from "../types";

const TEST_COMMAND = "npm test";
const BUILD_COMMAND = "npm run build";

export const paymentRetryTask: CodingTask = {
  id: "payment-retry-001",
  title: "Implement payment retry behavior",
  instruction: [
    "Implement the payment retry behavior in src/paymentRetry.ts (the retryPayment function). It currently makes",
    "only one attempt and ignores maxAttempts.",
    "",
    "Requirements:",
    "- Transient failures may be retried.",
    "- Validation/permanent failures must never be retried.",
    "- Never call attemptPayment more times than the configured maxAttempts.",
    "- A successful attempt must return immediately without any further attempts.",
    "- Preserve the existing exported types and function signature.",
    "",
    "Read tests/paymentRetry.test.ts to see the expected behavior in detail. Run the tests and the build before",
    "you consider the task complete.",
  ].join("\n"),
  fixturePath: "fixtures/payment-retry",
  allowedCommands: [TEST_COMMAND, BUILD_COMMAND],
  maxTurns: 8,
  commandTimeoutMs: 30_000,
  experimentTimeoutMs: 5 * 60_000,
  evaluator: async (ctx) => {
    const workspaceRoot = ctx.sandbox.root;
    if (!workspaceRoot) throw new Error("payment-retry evaluator requires a local sandbox root");

    const build = await runCheckCommand(ctx.runner, ctx.sandbox, "npm", ["run", "build"]);
    const publicTests = await runCheckCommand(ctx.runner, ctx.sandbox, "npm", ["test"]);

    // Capture evidence of the agent's own changes before adding the hidden test file.
    const changedFiles = diffChangedFiles(ctx.fixtureRoot, workspaceRoot);
    const diffResult = await runCheckCommand(ctx.runner, ctx.sandbox, "git", ["diff", "--no-color"]);

    const hiddenSource = path.join(ctx.fixtureRoot, "hidden", "paymentRetry.hidden.test.ts");
    const hiddenDest = path.join(workspaceRoot, "tests", "paymentRetry.hidden.test.ts");
    fs.copyFileSync(hiddenSource, hiddenDest);
    const combined = await runCheckCommand(ctx.runner, ctx.sandbox, "npm", ["test"]);

    return {
      evaluation: {
        buildPassed: build.passed,
        publicTestsPassed: publicTests.passed,
        hiddenTestsPassed: combined.passed,
        relevantTestsExecuted: wasCommandExecuted(ctx.trajectory, TEST_COMMAND),
      },
      changedFiles,
      diff: diffResult.stdout,
      raw: {
        build: { exitCode: build.exitCode, stderr: build.stderr },
        publicTests: { exitCode: publicTests.exitCode, stderr: publicTests.stderr },
        hiddenTests: { exitCode: combined.exitCode, stderr: combined.stderr },
      },
    };
  },
};
