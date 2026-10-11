// Offline calibration (section 6 of the benchmark brief): before spending any
// real Nemotron + Nebius Sandbox budget on a new benchmark case, sanity-check
// that its dimension count and replication policy can mathematically reach a
// decisive result IF the hypothesized mechanism (each case's `expectedShape`)
// holds — exactly the pattern already proven in scripts/diagnose-stable-simulate.ts
// (offline runner + an injected ground-truth runExperimentFn, zero Nebius calls,
// zero randomness). This never runs against real coding-agent behavior and
// never feeds its outcome back into the frozen diagnosis engine; it only
// answers "is this scenario winnable within its budget", one case at a time.
//
// Scenario D (stochastic-discount-apply) is intentionally excluded: it reuses
// an already-recorded real diagnosis instead of spending a fresh budget (see
// cases.ts), so there is nothing new to calibrate.
import { runStableDiagnosis } from "../src/lib/diagnosis/diagnose-stable";
import { diffManifests } from "../src/lib/harness/diff";
import { BENCHMARK_CASES } from "../src/lib/benchmark/cases";
import type { BenchmarkCase } from "../src/lib/benchmark/types";
import type { CodingTask, ExperimentResult } from "../src/lib/experiments/types";
import type { HarnessManifest } from "../src/lib/harness/types";
import type { SandboxHandle, SandboxRunner } from "../src/lib/sandbox/types";
import type { StableDiagnosisResult } from "../src/lib/diagnosis/types";

function fakeResult(success: boolean, manifestId: string): ExperimentResult {
  return {
    runId: `cal-${manifestId}-${Math.random()}`,
    taskId: "calibration",
    manifestId,
    success,
    terminationReason: success ? "completed" : "max_turns",
    evaluation: { buildPassed: true, publicTestsPassed: success, hiddenTestsPassed: success, relevantTestsExecuted: success },
    changedFiles: success ? ["src/placeholder.ts"] : [],
    metrics: { agentTurns: 8, toolCalls: 8, latencyMs: 1000, inputTokens: 100, outputTokens: 10, totalTokens: 110 },
    evidence: {
      trajectory: { turns: [], toolCallCount: 0, stopReason: success ? "completed" : "max_turns", terminationDetail: null, finalAssistantMessage: null, totalUsage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } },
      diff: "",
      evaluatorRaw: {},
      sandbox: { runner: "local", handleId: "cal" },
    },
  };
}

function offlineRunner(): SandboxRunner {
  const sharedHandle: SandboxHandle = { id: "cal-shared-base" };
  let forkCount = 0;
  return {
    async create() {
      return sharedHandle;
    },
    async forkFrom(_base, label) {
      forkCount += 1;
      return { id: `${label ?? "fork"}-${forkCount}` };
    },
    async execute() {
      throw new Error("not used in calibration");
    },
    async listFiles() {
      throw new Error("not used in calibration");
    },
    async readFile() {
      throw new Error("not used in calibration");
    },
    async writeFile() {
      throw new Error("not used in calibration");
    },
    async destroy() {},
  };
}

/**
 * bits are index-aligned with diffManifests(baseline, candidate) for this
 * case, using the same "0".repeat(n)/"1".repeat(n) convention diagnose-stable.ts
 * itself uses for the baseline/candidate endpoints.
 */
function groundTruthRunExperimentFn(baselineId: string, candidateId: string, dimensionCount: number, fails: (bits: string) => boolean) {
  return async (_t: CodingTask, manifest: HarnessManifest): Promise<ExperimentResult> => {
    const bits =
      manifest.id === baselineId ? "0".repeat(dimensionCount) : manifest.id === candidateId ? "1".repeat(dimensionCount) : manifest.id.replace("diagnostic-", "");
    return fakeResult(!fails(bits), manifest.id);
  };
}

interface Calibration {
  caseId: string;
  /** Ground truth expressed over the case's own bit order ("0".repeat(n) = baseline, "1".repeat(n) = candidate). */
  fails: (bits: string) => boolean;
}

// Hypothesized mechanisms, stated BEFORE any real run — see each case's `description` in cases.ts.
const CALIBRATIONS: Calibration[] = [
  // discount-apply, changed dims = [skills, contextPolicy]. Hypothesis: interaction (fail iff both candidate).
  { caseId: "interaction-discount-apply", fails: (bits) => bits[0] === "1" && bits[1] === "1" },
  // payment-retry, changed dims = [systemPrompt, skills]. Hypothesis: main effect on skills alone.
  { caseId: "main-effect-payment-retry", fails: (bits) => bits[1] === "1" },
  // duration-parse, changed dims = [systemPrompt]. Hypothesis: never regresses.
  { caseId: "benign-duration-parse", fails: () => false },
  // duration-parse, changed dims = [systemPrompt, execution.maxTurns, skills]. Hypothesis: main effect on skills alone.
  { caseId: "distractor-heavy-duration-parse", fails: (bits) => bits[2] === "1" },
];

function dimensionCountFor(bc: BenchmarkCase): number {
  return diffManifests(bc.baseline, bc.candidate).length;
}

async function calibrate(bc: BenchmarkCase, calibration: Calibration): Promise<void> {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`${bc.id} — hypothesized shape: ${bc.expectedShape}`);
  console.log("=".repeat(78));

  const result: StableDiagnosisResult = await runStableDiagnosis(
    { task: bc.task, baseline: bc.baseline, candidate: bc.candidate, replication: bc.replication },
    {
      runner: offlineRunner(),
      skipExplanation: true,
      runExperimentFn: groundTruthRunExperimentFn(bc.baseline.id, bc.candidate.id, dimensionCountFor(bc), calibration.fails),
    },
  );

  console.log(`changed dimensions: ${result.changedDimensions.join(", ")}`);
  console.log(`budget: ${bc.replication.maxTotalRuns}, used: ${result.totalCodingRuns}`);
  console.log(`result: ${JSON.stringify(result.diagnosis)}`);
  console.log(`evidence quality: ${result.stability.evidenceQuality}`);

  const matchesExpectation =
    bc.expectedShape === "no_regression"
      ? !result.regressionDetected
      : bc.expectedShape === "unstable"
        ? result.diagnosis.type === "inconclusive"
        : result.diagnosis.type === bc.expectedShape;

  console.log(
    matchesExpectation
      ? "CALIBRATION OK — the hypothesized mechanism is resolvable within this case's budget."
      : "CALIBRATION MISS — under the hypothesized ground truth, this budget/dimension count does NOT reach the expected shape. Reconsider the scenario before spending a real run.",
  );
  if (!matchesExpectation) process.exitCode = 1;
}

async function main() {
  console.log("HarnessLab benchmark — offline calibration (no Nebius calls, no randomness)\n");
  for (const calibration of CALIBRATIONS) {
    const bc = BENCHMARK_CASES.find((c) => c.id === calibration.caseId);
    if (!bc) throw new Error(`unknown benchmark case id in CALIBRATIONS: ${calibration.caseId}`);
    await calibrate(bc, calibration);
  }
}

main();
