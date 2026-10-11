import "server-only";

import path from "node:path";
import { readLocalFile } from "../../agent/local-fs";
import { diffChangedFiles, runCheckCommand, wasCommandExecuted } from "../evaluator";
import type { CodingTask } from "../types";

const TEST_COMMAND = "npm test";
const BUILD_COMMAND = "npm run build";

/**
 * Cross-project task: a slice of ApplyPilot-AI's ranked-jobs ordering
 * (services/job-dashboard/ranking.ts) turned into a HarnessLab fixture. The
 * agent-under-test is the coding agent that works on ApplyPilot, and the
 * harness under test is how it is guided (ApplyPilot's job-evaluation skill,
 * context policy). The fixture is local and deterministic — no ApplyPilot
 * code runs and nothing touches the network or a database.
 *
 * Like discount-apply, the rules that matter most (eligibility outranks score;
 * pending jobs go last) are stated only in src/rankingContract.ts, not in the
 * public tests or the instruction. Getting them right means the agent must
 * still have the contract in view when it writes the ranking.
 */
export const applypilotRankTask: CodingTask = {
  id: "applypilot-rank-001",
  title: "ApplyPilot: rank evaluated jobs by candidate fit",
  instruction: [
    "Implement rankJobs in src/rankJobs.ts. It currently returns the jobs in their given order and implements none of the",
    "ordering rules for ranking evaluated jobs against a candidate.",
    "",
    "Read src/rankingContract.ts for the exact ranking rules, and tests/rankJobs.test.ts for the expected behavior in detail.",
    "Run the tests and the build before you consider the task complete.",
  ].join("\n"),
  fixturePath: "fixtures/applypilot-rank",
  allowedCommands: [TEST_COMMAND, BUILD_COMMAND],
  commandTimeoutMs: 30_000,
  experimentTimeoutMs: 5 * 60_000,
  evaluator: async (ctx) => {
    const build = await runCheckCommand(ctx.runner, ctx.sandbox, "npm", ["run", "build"]);
    const publicTests = await runCheckCommand(ctx.runner, ctx.sandbox, "npm", ["test"]);

    const changedFiles = await diffChangedFiles(ctx.runner, ctx.sandbox, ctx.fixtureRoot);
    const diffResult = await runCheckCommand(ctx.runner, ctx.sandbox, "git", ["diff", "--no-color"]);

    const hiddenContent = readLocalFile(ctx.fixtureRoot, path.join("hidden", "rankJobs.hidden.test.ts"));
    await ctx.runner.writeFile(ctx.sandbox, "tests/rankJobs.hidden.test.ts", hiddenContent);
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
