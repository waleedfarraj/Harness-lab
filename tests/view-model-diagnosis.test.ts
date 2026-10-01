import assert from "node:assert/strict";
import { test } from "node:test";
import { toDiagnosisViewModel } from "../src/lib/view-model/diagnosis-view-model";
import type { ExperimentResult } from "../src/lib/experiments/types";
import type { HarnessManifest } from "../src/lib/harness/types";
import type {
  ConfigurationAggregate,
  DiagnosisHypothesis,
  DiagnosisResult,
  DiagnosticExperiment,
  StableDiagnosisResult,
  StablePlannerStep,
} from "../src/lib/diagnosis/types";

// ---------------------------------------------------------------------------
// Fixtures. These hand-build minimal but structurally valid backend evidence
// objects — the adapter under test never talks to disk or a live diagnosis
// run, so every scenario (interaction / main-effect / inconclusive / unstable
// / schema drift) is expressed directly as data, the same shape
// `.harnesslab/diagnoses/*.json` files have on disk.
// ---------------------------------------------------------------------------

function fakeResult(overrides: Partial<ExperimentResult> = {}): ExperimentResult {
  return {
    runId: overrides.runId ?? `run-${Math.random().toString(36).slice(2)}`,
    taskId: "fixture-task",
    manifestId: "fixture-manifest",
    success: true,
    terminationReason: "completed",
    evaluation: { buildPassed: true, publicTestsPassed: true, hiddenTestsPassed: true, relevantTestsExecuted: true },
    changedFiles: ["src/applyDiscount.ts"],
    metrics: { agentTurns: 3, toolCalls: 4, latencyMs: 12_000, inputTokens: 900, outputTokens: 120, totalTokens: 1020 },
    evidence: {
      trajectory: {
        turns: [
          {
            turn: 1,
            model: "nvidia/nemotron-3-super-120b-a12b",
            assistantContent: null,
            toolCalls: [
              { id: "t1", name: "read_file", arguments: { path: "src/applyDiscount.ts" }, ok: true, resultSummary: "file contents", resultChars: 400 },
              { id: "t2", name: "write_file", arguments: { path: "src/applyDiscount.ts", content: "export function applyDiscount() {}" }, ok: true, resultSummary: "wrote 40 chars", resultChars: 40 },
              { id: "t3", name: "run_command", arguments: { command: "npm test" }, ok: true, resultSummary: "exit 0", resultChars: 20 },
            ],
            startedAt: new Date().toISOString(),
            durationMs: 2000,
            usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 },
            request: { messageCount: 2, serializedSizeChars: 1200, contextPolicy: "full", preservedToolResultIdentifiers: [], compactedToolResultIdentifiers: [], newCompactionEvents: [] },
          },
        ],
        toolCallCount: 3,
        stopReason: "completed",
        terminationDetail: null,
        finalAssistantMessage: "done",
        totalUsage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 },
      },
      diff: "diff --git a/src/applyDiscount.ts b/src/applyDiscount.ts\n+export function applyDiscount() {}\n",
      evaluatorRaw: {},
      sandbox: { runner: "token-factory", handleId: "handle-1", metadata: { baseImage: "node:22-slim", forkedFrom: "chk-shared" } },
    },
    ...overrides,
  };
}

function aggregate(overrides: Partial<ConfigurationAggregate> & { configurationVector: string; runs: ExperimentResult[] }): ConfigurationAggregate {
  const passCount = overrides.runs.filter((r) => r.success).length;
  const failCount = overrides.runs.length - passCount;
  return {
    configuration: {},
    label: overrides.configurationVector,
    passCount,
    failCount,
    passRate: overrides.runs.length ? passCount / overrides.runs.length : 0,
    failureRate: overrides.runs.length ? failCount / overrides.runs.length : 0,
    terminationReasons: {},
    meanInputTokens: 900,
    meanOutputTokens: 120,
    meanLatencyMs: 12_000,
    stability: "mostly_pass",
    evidenceMaturity: "replicated",
    isDecisionCritical: false,
    ...overrides,
  };
}

function hyp(id: string, factors: string[], type: "main_effect" | "interaction", status: DiagnosisHypothesis["status"] = "possible"): DiagnosisHypothesis {
  return { id, factors: factors as never, type, status, evidenceFor: [], evidenceAgainst: [] };
}

const skillsContextHypotheses: DiagnosisHypothesis[] = [
  hyp("main_effect:skills", ["skills"], "main_effect"),
  hyp("main_effect:contextPolicy", ["contextPolicy"], "main_effect"),
  hyp("interaction:skills+contextPolicy", ["skills", "contextPolicy"], "interaction"),
];

function baseStableResult(overrides: Partial<StableDiagnosisResult> = {}): StableDiagnosisResult {
  const baselineRuns = [fakeResult({ success: true, manifestId: "baseline" })];
  const candidateRuns = [fakeResult({ success: false, manifestId: "candidate", terminationReason: "max_turns" })];
  const baselineAggregate = aggregate({ configurationVector: "00", runs: baselineRuns, stability: "mostly_pass", label: "baseline" });
  const candidateAggregate = aggregate({ configurationVector: "11", runs: candidateRuns, stability: "mostly_fail", label: "candidate" });
  return {
    diagnosisId: "diag-fixture",
    taskId: "discount-apply-001",
    changedDimensions: ["skills", "contextPolicy"],
    hypothesisSpace: skillsContextHypotheses,
    replicationPolicy: { minRunsPerConfiguration: 1, maxRunsPerConfiguration: 3, maxTotalRuns: 10, reservedConfirmationRuns: 2 },
    baselineAggregate,
    candidateAggregate,
    regressionDetected: true,
    steps: [],
    aggregates: [baselineAggregate, candidateAggregate],
    diagnosis: { type: "inconclusive", reason: "fixture placeholder" },
    stability: { totalRuns: 2, repeatedConfigurations: 0, unstableConfigurations: [], evidenceQuality: "low", reason: "fixture reason" },
    fixedMechanismsObserved: [],
    mechanismExplanation: null,
    exhaustiveConfigurations: 4,
    configurationsVisited: 2,
    configurationsAvoided: 2,
    searchSpaceReductionPct: 50,
    totalCodingRuns: 2,
    exploratoryRunCount: 0,
    confirmationRunCount: 0,
    sharedBaseCheckpoint: "chk-shared-1234567890",
    environmentPreparationMs: 500,
    ...overrides,
  };
}

const manifestCtx = {
  taskTitle: "Implement discount code application",
  taskInstruction: "Implement applyDiscount against the documented rules.",
  baselineManifest: {
    id: "baseline",
    name: "baseline",
    model: "nvidia/nemotron-3-super-120b-a12b",
    systemPrompt: "Baseline system prompt.",
    execution: { maxTurns: 8 },
    skills: [{ id: "baseline-skill-v1", content: "1. Do the thing." }],
    contextPolicy: "full",
  } satisfies HarnessManifest,
  candidateManifest: {
    id: "candidate",
    name: "candidate",
    model: "nvidia/nemotron-3-super-120b-a12b",
    systemPrompt: "Candidate system prompt.",
    execution: { maxTurns: 9 },
    skills: [{ id: "verification-skill-v2", content: "1. Do the thing faster." }],
    contextPolicy: "compact",
  } satisfies HarnessManifest,
};

// ---------------------------------------------------------------------------

test("interaction diagnosis rendering", () => {
  const raw = baseStableResult({ diagnosis: { type: "interaction", factors: ["skills", "contextPolicy"] } });
  const vm = toDiagnosisViewModel(raw, manifestCtx);
  assert.equal(vm.diagnosis.type, "interaction");
  if (vm.diagnosis.type !== "interaction") throw new Error("unreachable");
  assert.deepEqual(vm.diagnosis.factorLabels, ["Skill", "Context Policy"]);
  assert.equal(vm.diagnosis.headline, "Skill × Context Policy");
  assert.equal(vm.schemaSource, "stable");
});

test("main-effect diagnosis rendering", () => {
  const raw = baseStableResult({ diagnosis: { type: "main_effect", factors: ["contextPolicy"] } });
  const vm = toDiagnosisViewModel(raw, manifestCtx);
  assert.equal(vm.diagnosis.type, "main_effect");
  if (vm.diagnosis.type !== "main_effect") throw new Error("unreachable");
  assert.equal(vm.diagnosis.headline, "Context Policy");
});

test("inconclusive diagnosis rendering lists remaining hypotheses, not a forced winner", () => {
  const rejected = { ...skillsContextHypotheses[1], status: "rejected" as const };
  const hypothesisSpace = [skillsContextHypotheses[0], rejected, skillsContextHypotheses[2]];
  const raw = baseStableResult({
    hypothesisSpace,
    diagnosis: { type: "inconclusive", reason: "2 hypotheses remain consistent with the evidence collected so far." },
  });
  const vm = toDiagnosisViewModel(raw, manifestCtx);
  assert.equal(vm.diagnosis.type, "inconclusive");
  if (vm.diagnosis.type !== "inconclusive") throw new Error("unreachable");
  assert.equal(vm.diagnosis.remainingHypotheses.length, 2);
  assert.ok(vm.diagnosis.remainingHypotheses.every((h) => h.status !== "rejected"));
  assert.match(vm.diagnosis.reason, /2 hypotheses remain/);
});

test("unstable configuration renders as its own status, not pass or fail", () => {
  const unstableRuns = [fakeResult({ success: true }), fakeResult({ success: false })];
  const unstableAgg = aggregate({ configurationVector: "10", runs: unstableRuns, stability: "unstable", evidenceMaturity: "unstable", label: "skills=candidate,contextPolicy=baseline" });
  const raw = baseStableResult({
    aggregates: [baseStableResult().baselineAggregate, baseStableResult().candidateAggregate, unstableAgg],
    stability: { totalRuns: 4, repeatedConfigurations: 1, unstableConfigurations: ["10"], evidenceQuality: "low", reason: "1 configuration remained unstable" },
  });
  const vm = toDiagnosisViewModel(raw, manifestCtx);
  const cell = vm.configurationGrid.find((c) => c.bits === "10");
  assert.equal(cell?.status, "unstable");
  assert.deepEqual(vm.stability?.unstableConfigurationBits, ["10"]);
});

test("search-space metrics: grid size matches 2^dimensions and reflects visited vs not-tested", () => {
  const raw = baseStableResult();
  const vm = toDiagnosisViewModel(raw, manifestCtx);
  assert.equal(vm.configurationGrid.length, 4);
  assert.equal(vm.exhaustiveConfigurations, 4);
  const notTested = vm.configurationGrid.filter((c) => c.status === "not_tested");
  assert.equal(notTested.length, 2); // "01" and "10" were never visited in this fixture
  const baselineCell = vm.configurationGrid.find((c) => c.bits === "00");
  const candidateCell = vm.configurationGrid.find((c) => c.bits === "11");
  assert.equal(baselineCell?.status, "baseline");
  assert.equal(candidateCell?.status, "candidate");
});

test("planner step transformation carries technical fields and hypothesis partitioning", () => {
  const runResult = fakeResult({ success: false, manifestId: "diagnostic-01" });
  const step: StablePlannerStep = {
    step: 1,
    action: "explore",
    bits: "01",
    configuration: { skills: "baseline", contextPolicy: "candidate" },
    informationScore: 1,
    decisionCriticality: 1,
    separatorRarityScore: 0.5,
    rarePairsSeparated: 1,
    lookaheadRisk: false,
    whySelected: "Separates the two leading hypotheses.",
    remainingRunBudget: 6,
    reservedConfirmationRuns: 2,
    hypothesesBefore: skillsContextHypotheses,
    runResult,
    aggregateAfter: aggregate({ configurationVector: "01", runs: [runResult], stability: "mostly_fail", label: "skills=baseline,contextPolicy=candidate" }),
    provisionalHypothesesAfter: skillsContextHypotheses,
    confirmedHypothesesAfter: [skillsContextHypotheses[0], { ...skillsContextHypotheses[1], status: "rejected" }, skillsContextHypotheses[2]],
    hypothesesRejected: [{ ...skillsContextHypotheses[1], status: "rejected" }],
    hypothesesRemaining: [skillsContextHypotheses[0], skillsContextHypotheses[2]],
  };
  const raw = baseStableResult({ steps: [step] });
  const vm = toDiagnosisViewModel(raw, manifestCtx);
  assert.equal(vm.steps.length, 1);
  const vmStep = vm.steps[0];
  assert.equal(vmStep.action, "explore");
  assert.equal(vmStep.resultPass, false);
  assert.equal(vmStep.technical.decisionCriticality, 1);
  assert.equal(vmStep.technical.separatorRarityScore, 0.5);
  assert.equal(vmStep.technical.remainingRunBudget, 6);
  assert.equal(vmStep.hypothesesEliminated.length, 1);
  assert.equal(vmStep.hypothesesEliminated[0].label, "Context Policy");
  assert.equal(vmStep.hypothesesRemaining.length, 2);
  assert.deepEqual(vmStep.changedFromBaselineLabels, ["Context Policy"]);
});

test("missing optional planner metadata (schema drift) degrades to null, never throws or fabricates", () => {
  const runResult = fakeResult({ success: true });
  // Simulate a real on-disk evidence file recorded before Milestone 9 added
  // separatorRarityScore/rarePairsSeparated/lookaheadRisk — those keys are
  // simply absent, exactly like several real .harnesslab/diagnoses/*.json files.
  const legacyShapedStep = {
    step: 1,
    action: "explore",
    bits: "01",
    configuration: { skills: "baseline", contextPolicy: "candidate" },
    informationScore: 1,
    decisionCriticality: 1,
    whySelected: "Best separates the remaining hypotheses.",
    remainingRunBudget: 6,
    reservedConfirmationRuns: 2,
    hypothesesBefore: skillsContextHypotheses,
    runResult,
    aggregateAfter: aggregate({ configurationVector: "01", runs: [runResult], label: "skills=baseline,contextPolicy=candidate" }),
    provisionalHypothesesAfter: skillsContextHypotheses,
    confirmedHypothesesAfter: skillsContextHypotheses,
    hypothesesRejected: [],
    hypothesesRemaining: skillsContextHypotheses,
  } as unknown as StablePlannerStep;

  const raw = baseStableResult({ steps: [legacyShapedStep] });
  const vm = toDiagnosisViewModel(raw, manifestCtx);
  const step = vm.steps[0];
  assert.equal(step.technical.separatorRarityScore, null);
  assert.equal(step.technical.rarePairsSeparated, null);
  assert.equal(step.technical.lookaheadRisk, null);
  assert.equal(step.technical.informationScore, 1); // fields that WERE present still come through
});

test("missing manifest context degrades dimension changes to generic labels instead of throwing", () => {
  const raw = baseStableResult();
  const vm = toDiagnosisViewModel(raw); // no ctx at all
  assert.equal(vm.taskTitle, raw.taskId);
  assert.equal(vm.baseline.harness, null);
  assert.equal(vm.candidate.harness, null);
  for (const change of vm.dimensionChanges) {
    assert.equal(change.baselineValue, "baseline");
    assert.equal(change.candidateValue, "candidate");
    assert.equal(change.baselineDetail, null);
  }
});

test("no-secret rendering: raw evaluator output and unrequested fields never leak into the view model", () => {
  const secretRun = fakeResult({
    success: false,
    evidence: {
      trajectory: fakeResult().evidence.trajectory,
      diff: "",
      evaluatorRaw: { env: { NEBIUS_API_KEY: "sk-should-never-appear" }, note: "sk-should-never-appear" },
      sandbox: { runner: "token-factory", handleId: "handle-2" },
    },
  });
  const raw = baseStableResult({ candidateAggregate: aggregate({ configurationVector: "11", runs: [secretRun], stability: "mostly_fail", label: "candidate" }) });
  const vm = toDiagnosisViewModel(raw, manifestCtx);
  const serialized = JSON.stringify(vm);
  assert.ok(!serialized.includes("sk-should-never-appear"));
  assert.ok(!serialized.includes("evaluatorRaw"));
});

// ---------------------------------------------------------------------------
// Legacy (Milestone 6, pre-replication) schema
// ---------------------------------------------------------------------------

function legacyExperiment(overrides: Partial<DiagnosticExperiment> = {}): DiagnosticExperiment {
  const result = fakeResult({ success: false });
  return {
    step: 1,
    bits: "01",
    configuration: { skills: "baseline", contextPolicy: "candidate" },
    manifest: manifestCtx.candidateManifest,
    informationScore: 1,
    whySelected: "Best separates 3 remaining hypotheses.",
    hypothesesBefore: skillsContextHypotheses,
    result,
    hypothesesAfter: skillsContextHypotheses,
    hypothesesRejected: [{ ...skillsContextHypotheses[0], status: "rejected" }],
    hypothesesRemaining: [skillsContextHypotheses[1], skillsContextHypotheses[2]],
    ...overrides,
  };
}

function legacyResult(overrides: Partial<DiagnosisResult> = {}): DiagnosisResult {
  return {
    diagnosisId: "legacy-fixture",
    taskId: "discount-apply-001",
    baselineResult: fakeResult({ success: true }),
    candidateResult: fakeResult({ success: false }),
    regressionDetected: true,
    changedDimensions: ["skills", "contextPolicy"],
    hypothesisSpace: skillsContextHypotheses,
    experiments: [legacyExperiment()],
    diagnosis: { type: "interaction", factors: ["skills", "contextPolicy"] },
    evidence: [],
    fixedMechanismsObserved: [],
    mechanismExplanation: "Explanation text.",
    experimentsRun: 1,
    exhaustiveConfigurations: 4,
    configurationsExecuted: 3,
    configurationsAvoided: 1,
    searchSpaceReductionPct: 25,
    sharedBaseCheckpoint: "chk-legacy",
    environmentPreparationMs: 300,
    ...overrides,
  };
}

test("legacy (Milestone 6) schema renders with schemaSource 'legacy' and no stability panel data", () => {
  const vm = toDiagnosisViewModel(legacyResult(), manifestCtx);
  assert.equal(vm.schemaSource, "legacy");
  assert.equal(vm.stability, null);
  assert.equal(vm.diagnosis.type, "interaction");
  assert.equal(vm.steps.length, 1);
  assert.equal(vm.steps[0].technical.decisionCriticality, null);
  assert.equal(vm.baseline.result, "PASS");
  assert.equal(vm.candidate.result, "FAIL");
});
