import "server-only";

import path from "node:path";
import { readLocalFile } from "../../agent/local-fs";
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
  commandTimeoutMs: 30_000,
  experimentTimeoutMs: 5 * 60_000,
  evaluator: async (ctx) => {
    const build = await runCheckCommand(ctx.runner, ctx.sandbox, "npm", ["run", "build"]);
    const publicTests = await runCheckCommand(ctx.runner, ctx.sandbox, "npm", ["test"]);

    // Capture evidence of the agent's own changes before adding the hidden test file.
    const changedFiles = await diffChangedFiles(ctx.runner, ctx.sandbox, ctx.fixtureRoot);
    const diffResult = await runCheckCommand(ctx.runner, ctx.sandbox, "git", ["diff", "--no-color"]);

    // Injected via the runner (not direct fs), so this also works against a remote Sandbox
    // checkpoint. The hidden test's content only ever comes from local disk — HarnessLab
    // reads its own canonical fixture, the agent never sees it before this point.
    const hiddenContent = readLocalFile(ctx.fixtureRoot, path.join("hidden", "paymentRetry.hidden.test.ts"));
    await ctx.runner.writeFile(ctx.sandbox, "tests/paymentRetry.hidden.test.ts", hiddenContent);
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
