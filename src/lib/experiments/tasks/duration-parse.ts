import "server-only";

import path from "node:path";
import { readLocalFile } from "../../agent/local-fs";
import { diffChangedFiles, runCheckCommand, wasCommandExecuted } from "../evaluator";
import type { CodingTask } from "../types";

const TEST_COMMAND = "npm test";
const BUILD_COMMAND = "npm run build";

/**
 * Parsing/validation fixture, distinct in shape from discount-apply
 * (business-rule/contract logic) and payment-retry (retry/error handling).
 * Its contract (src/durationContract.ts) is modeled on the real `ms` npm
 * package's documented behavior (see THIRD_PARTY_NOTICES.md for source
 * repo/commit/license) — no source code from that project is copied here.
 *
 * Like discount-apply, it has one requirement stated only in the contract
 * file, not in the public tests: inputs longer than MAX_INPUT_LENGTH must
 * return undefined rather than throwing. Getting this right requires the
 * agent to still have that contract detail in view when it writes the
 * implementation — exactly the thing a context policy or a
 * skip-re-reading-files skill can take away.
 */
export const durationParseTask: CodingTask = {
  id: "duration-parse-001",
  title: "Implement duration-string parsing",
  instruction: [
    "Implement parseDuration in src/duration.ts. It currently always returns undefined and does not implement",
    "unit parsing, decimal/negative number support, or the maximum-input-length guard.",
    "",
    "Read src/durationContract.ts for the exact parsing rules a duration string must satisfy, and",
    "tests/duration.test.ts for the expected behavior in detail. Run the tests and the build before you",
    "consider the task complete.",
  ].join("\n"),
  fixturePath: "fixtures/duration-parse",
  allowedCommands: [TEST_COMMAND, BUILD_COMMAND],
  commandTimeoutMs: 30_000,
  experimentTimeoutMs: 5 * 60_000,
  evaluator: async (ctx) => {
    const build = await runCheckCommand(ctx.runner, ctx.sandbox, "npm", ["run", "build"]);
    const publicTests = await runCheckCommand(ctx.runner, ctx.sandbox, "npm", ["test"]);

    const changedFiles = await diffChangedFiles(ctx.runner, ctx.sandbox, ctx.fixtureRoot);
    const diffResult = await runCheckCommand(ctx.runner, ctx.sandbox, "git", ["diff", "--no-color"]);

    const hiddenContent = readLocalFile(ctx.fixtureRoot, path.join("hidden", "duration.hidden.test.ts"));
    await ctx.runner.writeFile(ctx.sandbox, "tests/duration.hidden.test.ts", hiddenContent);
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
