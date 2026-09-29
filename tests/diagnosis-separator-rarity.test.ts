// Milestone 9: separator rarity / unique-separator value. Section 8's
// adversarial synthetic cases (A-E), plus direct unit coverage of
// `computeSeparatorRarity` itself. See stability.ts and stable-planner.ts
// for the mechanism; see diagnosis-stable-planner.test.ts for the renamed
// Milestone 8 planner kept for comparison, and diagnosis-stable.test.ts for
// end-to-end `runStableDiagnosis` coverage (including the real skills x
// contextPolicy fixture, which this milestone leaves at the same honest
// INCONCLUSIVE result — see this file's final comment block for why that is
// a genuine budget/information-theoretic limit, not a planner defect).
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { bitsToConfiguration, buildHypothesisSpace } from "../src/lib/diagnosis/hypotheses";
import { computeSeparatorRarity, hypothesisPairId, RARE_SEPARATOR_THRESHOLD } from "../src/lib/diagnosis/stability";
import { scoreConfiguration } from "../src/lib/diagnosis/planner";
import { keyIsBetter, selectNextAction } from "../src/lib/diagnosis/stable-planner";
import { runStableDiagnosis } from "../src/lib/diagnosis/diagnose-stable";
import { baselineV1 } from "../src/lib/harness/manifests/baseline-v1";
import { baselineSkill } from "../src/lib/harness/skills/baseline-skill";
import { verificationSkillV2 } from "../src/lib/harness/skills/verification-skill-v2";
import type { CodingTask, ExperimentResult } from "../src/lib/experiments/types";
import type { ConfigurationAggregate, DiagnosisHypothesis, ReplicationPolicy } from "../src/lib/diagnosis/types";
import type { HarnessDimension, HarnessManifest } from "../src/lib/harness/types";
import type { SandboxHandle, SandboxRunner } from "../src/lib/sandbox/types";

const DIMS3: HarnessDimension[] = ["skills", "contextPolicy", "systemPrompt"];
const POLICY: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 3, maxTotalRuns: 10, reservedConfirmationRuns: 2 };

function aggregateOf(bits: string, dims: HarnessDimension[], stability: ConfigurationAggregate["stability"] = "mostly_pass"): ConfigurationAggregate {
  return {
    configurationVector: bits,
    configuration: bitsToConfiguration(bits, dims),
    label: bits,
    runs: [],
    passCount: 0,
    failCount: 0,
    passRate: 0,
    failureRate: 0,
    terminationReasons: {},
    meanInputTokens: 0,
    meanOutputTokens: 0,
    meanLatencyMs: 0,
    stability,
    evidenceMaturity: "replicated",
    isDecisionCritical: false,
  };
}

function untestedConfigsFor(dims: HarnessDimension[], excludeBits: Set<string>): Map<string, ReturnType<typeof bitsToConfiguration>> {
  const total = 2 ** dims.length;
  const configs = new Map<string, ReturnType<typeof bitsToConfiguration>>();
  for (let n = 0; n < total; n++) {
    const bits = n.toString(2).padStart(dims.length, "0");
    if (excludeBits.has(bits)) continue;
    configs.set(bits, bitsToConfiguration(bits, dims));
  }
  return configs;
}

// --- Direct unit coverage of computeSeparatorRarity ---

test("hypothesisPairId: stable, order-independent identifier for a pair", () => {
  const [a, b] = buildHypothesisSpace(["skills"]).concat(buildHypothesisSpace(["contextPolicy"]));
  assert.equal(hypothesisPairId(a, b), hypothesisPairId(b, a));
});

test("computeSeparatorRarity: a pair with only 1 remaining separator gives that configuration a full point for it", () => {
  const space = buildHypothesisSpace(DIMS3);
  const confirmedRemaining = space.filter((h) => h.id === "main_effect:skills" || h.id === "interaction:skills+contextPolicy");
  // The only pair present separates exactly at skills=candidate, contextPolicy=baseline (systemPrompt free) -> 4 configs total,
  // but if only ONE of them remains untested, that one configuration must receive the full 1/1 = 1.0 credit.
  const untested = untestedConfigsFor(DIMS3, new Set(["000", "111", "110", "010", "011", "101"])); // leaves only "100","001" untested
  const rarity = computeSeparatorRarity(confirmedRemaining, untested);
  // Of the remaining untested pool, only "100" (skills=candidate, contextPolicy=baseline, systemPrompt=baseline) separates the pair.
  const r100 = rarity.get("100")!;
  assert.equal(r100.score, 1);
  assert.equal(r100.rarePairsSeparated, 1);
  assert.equal(r100.pairsSeparated.length, 1);
  assert.equal(r100.pairsSeparated[0].remainingSeparatorCount, 1);
  // Configurations that don't separate the pair at all get no credit.
  assert.equal(rarity.get("001")!.score, 0);
});

test("computeSeparatorRarity: a pair with many remaining separators dilutes credit across all of them, summing exactly to 1", () => {
  const space = buildHypothesisSpace(DIMS3);
  const confirmedRemaining = space.filter((h) => h.id === "main_effect:skills" || h.id === "interaction:skills+contextPolicy");
  const untested = untestedConfigsFor(DIMS3, new Set(["000", "111"])); // all 6 remain untested
  const rarity = computeSeparatorRarity(confirmedRemaining, untested);
  const separating = ["100", "101"].filter((b) => bitsToConfiguration(b, DIMS3).skills === "candidate" && bitsToConfiguration(b, DIMS3).contextPolicy === "baseline");
  assert.equal(separating.length, 2);
  const total = separating.reduce((sum, b) => sum + rarity.get(b)!.score, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "credit for one pair must sum to exactly 1 across every configuration that separates it");
  for (const b of separating) assert.equal(rarity.get(b)!.score, 0.5);
});

test("computeSeparatorRarity: a pair with zero remaining separators contributes to no configuration's score", () => {
  const space = buildHypothesisSpace(DIMS3);
  const confirmedRemaining = space.filter((h) => h.id === "main_effect:skills" || h.id === "interaction:skills+contextPolicy");
  // Exclude every configuration that could ever separate this pair (skills=candidate, contextPolicy=baseline, any systemPrompt).
  const untested = untestedConfigsFor(DIMS3, new Set(["000", "111", "100", "101"]));
  const rarity = computeSeparatorRarity(confirmedRemaining, untested);
  for (const entry of rarity.values()) {
    assert.equal(entry.score, 0);
    assert.equal(entry.pairsSeparated.length, 0);
  }
});

test("RARE_SEPARATOR_THRESHOLD: rarePairsSeparated only counts pairs at or under the documented threshold", () => {
  assert.ok(RARE_SEPARATOR_THRESHOLD >= 1);
  const space = buildHypothesisSpace(DIMS3);
  // main_effect:skills vs main_effect:contextPolicy disagree whenever skills != contextPolicy (any systemPrompt) --
  // 4 configs ("010","011","100","101"), comfortably above a rarity threshold of 2.
  const confirmedRemaining = space.filter((h) => h.id === "main_effect:skills" || h.id === "main_effect:contextPolicy");
  const untested = untestedConfigsFor(DIMS3, new Set(["000", "111"]));
  const rarity = computeSeparatorRarity(confirmedRemaining, untested);
  for (const entry of rarity.values()) assert.equal(entry.rarePairsSeparated, 0, "a pair with 4 remaining separators is not 'rare' under a threshold of 2");
});

// --- Section 3: tier ordering itself (broad-vs-rarity), tested directly since in this hypothesis
// model the two signals are empirically strongly correlated at the very first diagnostic step (see
// Case C below) -- the meaningful thing to verify is that a higher tier-1 value always wins outright. ---

test("keyIsBetter: a higher first-tier value wins outright, regardless of how much better the loser scores on every later tier", () => {
  const highInfoLowRarity = [5, 0, 0, 0];
  const lowInfoHighRarity = [3, 100, 100, 100];
  assert.equal(keyIsBetter(highInfoLowRarity, lowInfoHighRarity), true);
  assert.equal(keyIsBetter(lowInfoHighRarity, highInfoLowRarity), false);
});

test("keyIsBetter: falls through to later tiers only once earlier tiers are exactly tied", () => {
  assert.equal(keyIsBetter([5, 2], [5, 1]), true);
  assert.equal(keyIsBetter([5, 1], [5, 2]), false);
  assert.equal(keyIsBetter([5, 5], [5, 5]), false);
});

// --- Case A: a main effect and its corresponding pairwise interaction have only one (or very few)
// rare separating corners among several other already-resolved hypotheses; the planner must find it. ---

test("Case A: once narrowed to a mix including one hard-to-separate pair, the planner selects the rare corner over broader-but-less-decisive options", () => {
  const space = buildHypothesisSpace(DIMS3);
  const byId = new Map(space.map((h) => [h.id, h] as const));
  // 4 of the 6 hypotheses survive (2 interactions already confirmed-rejected) -> "narrowed" phase (totalHypotheses=6).
  const confirmedRemaining: DiagnosisHypothesis[] = [
    byId.get("main_effect:skills")!,
    byId.get("main_effect:contextPolicy")!,
    byId.get("main_effect:systemPrompt")!,
    byId.get("interaction:skills+contextPolicy")!,
  ];
  const baseline = aggregateOf("000", DIMS3, "mostly_pass");
  const candidate = aggregateOf("111", DIMS3, "mostly_fail");
  const planned = selectNextAction(DIMS3, confirmedRemaining, confirmedRemaining, [baseline, candidate], POLICY, 6);
  assert.ok(planned);
  assert.equal(planned!.action, "explore");
  // "011" (skills=baseline, contextPolicy=candidate, systemPrompt=candidate) is one of only 2 remaining configurations
  // that separates interaction:skills+contextPolicy from main_effect:contextPolicy -- the rare pair -- and ties on every
  // other axis with its lexicographically-later twin "101", so it wins on decisionCriticality/rarity plus the bits tie-break.
  assert.equal(planned!.bits, "011");
  assert.equal(planned!.decisionCriticality, 4);
  assert.equal(planned!.rarePairsSeparated, 1);
  assert.match(planned!.whySelected, /one of only 2 remaining configuration/);
});

// --- Case B: a different pairwise interaction is the true explanation -- the mechanism must be generic,
// never keyed to a specific dimension pair. ---

test("Case B: the same rarity mechanism finds a DIFFERENT hard pair (contextPolicy x systemPrompt), proving it isn't keyed to any specific dimension", () => {
  const space = buildHypothesisSpace(DIMS3);
  const byId = new Map(space.map((h) => [h.id, h] as const));
  const confirmedRemaining: DiagnosisHypothesis[] = [
    byId.get("main_effect:skills")!,
    byId.get("main_effect:contextPolicy")!,
    byId.get("main_effect:systemPrompt")!,
    byId.get("interaction:contextPolicy+systemPrompt")!,
  ];
  const baseline = aggregateOf("000", DIMS3, "mostly_pass");
  const candidate = aggregateOf("111", DIMS3, "mostly_fail");
  const planned = selectNextAction(DIMS3, confirmedRemaining, confirmedRemaining, [baseline, candidate], POLICY, 6);
  assert.ok(planned);
  assert.equal(planned!.bits, "101");
  assert.match(planned!.whySelected, /interaction:contextPolicy\+systemPrompt/);
  assert.match(planned!.whySelected, /main_effect:systemPrompt/);
});

// --- Case C: a broad high-information experiment is genuinely better than chasing a rare corner
// prematurely -- the tier order itself (informationScore first in the "early" phase) is what
// guarantees this; see the keyIsBetter tests above for why it's tested at that level here. ---

test("Case C: at the very first diagnostic step (full hypothesis space, 'early' phase), the planner's own tier order ranks informationScore ahead of separatorRarityScore", () => {
  // This is a structural fact about the shipped ranking (see bestExploreCandidateV9's `phase === "early"`
  // branch in stable-planner.ts: `key = [informationScore, rarityEntry.score, dcForRanking, safe]`), verified
  // here end-to-end: at a genuinely fresh state, whatever the planner selects must be a joint top-scorer on
  // informationScore among the untested pool -- it can never be out-ranked by a configuration with lower
  // informationScore just because that configuration has higher rarity.
  const space = buildHypothesisSpace(DIMS3);
  const baseline = aggregateOf("000", DIMS3, "mostly_pass");
  const candidate = aggregateOf("111", DIMS3, "mostly_fail");
  const planned = selectNextAction(DIMS3, space, space, [baseline, candidate], POLICY, 6);
  assert.ok(planned);

  const untested = untestedConfigsFor(DIMS3, new Set(["000", "111"]));
  let maxInfo = -Infinity;
  for (const config of untested.values()) {
    const { informationScore } = scoreConfiguration(config, space);
    if (informationScore > maxInfo) maxInfo = informationScore;
  }
  assert.equal(planned!.informationScore, maxInfo, "the selected configuration must be a top informationScore scorer, never displaced by a lower-information but rarer alternative");
});

// --- Case D: no unique diagnosis is possible under budget -> INCONCLUSIVE, reported honestly. ---

test("Case D: a budget too small to fully resolve a narrowed-but-still-ambiguous pair stays honestly INCONCLUSIVE", async (t) => {
  const task: CodingTask = {
    id: "rarity-case-d",
    title: "t",
    instruction: "do the thing",
    fixturePath: "fixtures/does-not-matter",
    allowedCommands: ["npm test"],
    evaluator: async () => {
      throw new Error("not used: runExperimentFn is mocked");
    },
  };
  const baseline: HarnessManifest = { ...baselineV1, id: "case-d-baseline", name: "case-d-baseline", skills: [baselineSkill], contextPolicy: "full" };
  const candidate: HarnessManifest = { ...baselineV1, id: "case-d-candidate", name: "case-d-candidate", skills: [verificationSkillV2], contextPolicy: "compact" };

  function fakeResult(success: boolean, manifestId: string): ExperimentResult {
    return {
      runId: `r-${manifestId}-${Math.random()}`,
      taskId: task.id,
      manifestId,
      success,
      terminationReason: success ? "completed" : "max_turns",
      evaluation: { buildPassed: true, publicTestsPassed: success, hiddenTestsPassed: success, relevantTestsExecuted: success },
      changedFiles: [],
      metrics: { agentTurns: 8, toolCalls: 8, latencyMs: 1000, inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      evidence: {
        trajectory: { turns: [], toolCallCount: 0, stopReason: success ? "completed" : "max_turns", terminationDetail: null, finalAssistantMessage: null, totalUsage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } },
        diff: "",
        evaluatorRaw: {},
        sandbox: { runner: "local", handleId: "x" },
      },
    };
  }

  function fakeRunner(): SandboxRunner {
    const shared: SandboxHandle = { id: "shared" };
    let n = 0;
    return {
      async create() {
        return shared;
      },
      async forkFrom(_base, label) {
        n += 1;
        return { id: `${label ?? "fork"}-${n}` };
      },
      async execute() {
        throw new Error("not used");
      },
      async listFiles() {
        throw new Error("not used");
      },
      async readFile() {
        throw new Error("not used");
      },
      async writeFile() {
        throw new Error("not used");
      },
      async destroy() {},
    };
  }

  // Fails iff skills=candidate AND contextPolicy=candidate -- an interaction that, per this file's own
  // Case A/B analysis, needs 2 distinct dimensions' worth of isolating evidence to fully resolve. A budget
  // that only covers baseline+candidate replication plus ONE diagnostic replicate cannot possibly finish.
  const tinyPolicy: ReplicationPolicy = { minRunsPerConfiguration: 2, maxRunsPerConfiguration: 2, maxTotalRuns: 6, reservedConfirmationRuns: 1 };
  const scripts: Record<string, boolean[]> = {
    "case-d-baseline": [true, true],
    "case-d-candidate": [false, false],
  };
  const runExperimentFn = async (_t: CodingTask, manifest: HarnessManifest): Promise<ExperimentResult> => {
    const script = scripts[manifest.id];
    if (script) return fakeResult(script.shift() ?? script[0] ?? true, manifest.id);
    const bits = manifest.id.replace("diagnostic-", "");
    return fakeResult(!(bits[0] === "1" && bits[1] === "1"), manifest.id);
  };

  const result = await runStableDiagnosis({ task, baseline, candidate, replication: tinyPolicy }, { runner: fakeRunner(), skipExplanation: true, runExperimentFn });
  t.after(() => fs.rmSync(path.join(process.cwd(), ".harnesslab", "diagnoses", `${result.diagnosisId}.json`), { force: true }));

  assert.ok(result.totalCodingRuns <= 6);
  assert.equal(result.diagnosis.type, "inconclusive");
  assert.ok((result.diagnosis as { reason: string }).reason.length > 0);
});

// --- Case E: several configurations provide equivalent separation -- tie-breaking must be deterministic. ---

test("Case E: when multiple configurations are exactly tied on every scored dimension, selection is deterministic and picks the lexicographically smallest bits", () => {
  const space = buildHypothesisSpace(DIMS3);
  const byId = new Map(space.map((h) => [h.id, h] as const));
  const confirmedRemaining: DiagnosisHypothesis[] = [
    byId.get("main_effect:skills")!,
    byId.get("main_effect:contextPolicy")!,
    byId.get("main_effect:systemPrompt")!,
    byId.get("interaction:skills+contextPolicy")!,
  ];
  const baseline = aggregateOf("000", DIMS3, "mostly_pass");
  const candidate = aggregateOf("111", DIMS3, "mostly_fail");

  // "011" and "101" are exactly tied on decisionCriticality (4), separatorRarityScore (1.25), and informationScore (2)
  // -- see Case A's analysis. Repeated calls with identical inputs must always resolve the tie the same way.
  const results = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const planned = selectNextAction(DIMS3, confirmedRemaining, confirmedRemaining, [baseline, candidate], POLICY, 6);
    results.add(planned!.bits);
  }
  assert.deepEqual([...results], ["011"]);
  assert.ok("011" < "101", "sanity check on the expected tie-break winner");
});
