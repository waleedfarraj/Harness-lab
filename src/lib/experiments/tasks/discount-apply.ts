import "server-only";

import path from "node:path";
import { readLocalFile } from "../../agent/local-fs";
import { diffChangedFiles, runCheckCommand, wasCommandExecuted } from "../evaluator";
import type { CodingTask } from "../types";

const TEST_COMMAND = "npm test";
const BUILD_COMMAND = "npm run build";

/**
 * Milestone 4's interaction fixture. Deliberately has one requirement that
 * is stated only in src/discountContract.ts (not in the public tests or the
 * task instruction verbatim): an expired code must be reported as
 * "expired", not "not_found". Getting this right requires the agent to
 * still have that contract detail in view when it writes the
 * implementation — exactly the thing a context policy can take away.
 */
export const discountApplyTask: CodingTask = {
  id: "discount-apply-001",
  title: "Implement discount code application",
  instruction: [
    "Implement applyDiscount in src/applyDiscount.ts. It currently always returns not_found and does not implement",
    "any of the catalog lookup, minimum-spend, or expiry rules.",
    "",
    "Read src/discountContract.ts for the exact validation rules a discount code must satisfy, and",
    "tests/applyDiscount.test.ts for the expected behavior in detail. Run the tests and the build before you",
    "consider the task complete.",
  ].join("\n"),
  fixturePath: "fixtures/discount-apply",
  allowedCommands: [TEST_COMMAND, BUILD_COMMAND],
  commandTimeoutMs: 30_000,
  experimentTimeoutMs: 5 * 60_000,
  evaluator: async (ctx) => {
    const build = await runCheckCommand(ctx.runner, ctx.sandbox, "npm", ["run", "build"]);
    const publicTests = await runCheckCommand(ctx.runner, ctx.sandbox, "npm", ["test"]);

    const changedFiles = await diffChangedFiles(ctx.runner, ctx.sandbox, ctx.fixtureRoot);
    const diffResult = await runCheckCommand(ctx.runner, ctx.sandbox, "git", ["diff", "--no-color"]);

    const hiddenContent = readLocalFile(ctx.fixtureRoot, path.join("hidden", "applyDiscount.hidden.test.ts"));
    await ctx.runner.writeFile(ctx.sandbox, "tests/applyDiscount.hidden.test.ts", hiddenContent);
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
