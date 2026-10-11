import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_DEMO_EVIDENCE_KEY, DEMO_EVIDENCE, findDemoEvidence } from "../src/lib/demo/evidence-catalog";
import { isEvidenceAvailable, loadDiagnosisForDemo } from "../src/lib/demo/load-diagnosis";
import { locateEvidenceFile } from "../src/lib/demo/locate-evidence";
import { computeTraceFindings } from "../src/lib/demo/trace-findings";
import type { StableDiagnosisResult } from "../src/lib/diagnosis/types";

// These tests read the TRACKED snapshot in demo-evidence/ (a byte copy of a real recorded run), never the
// git-ignored .harnesslab/ directory, so they pass on a fresh clone. Synthetic variants built below are test
// inputs for the locator only; they are never rendered as evidence.

const SNAPSHOT_DIR = path.join(process.cwd(), "demo-evidence", "applypilot-regression");
const snapshotPath = path.join(SNAPSHOT_DIR, "diagnosis.json");
const readSnapshot = () => JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as StableDiagnosisResult;

test("snapshot is an unmodified copy: sha256 matches provenance", () => {
  const provenance = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, "provenance.json"), "utf8")) as { sha256: string; diagnosisId: string };
  const actual = crypto.createHash("sha256").update(fs.readFileSync(snapshotPath)).digest("hex");
  assert.equal(actual, provenance.sha256);
  assert.equal(readSnapshot().diagnosisId, provenance.diagnosisId);
});

test("headline result is preserved: contextPolicy main effect, HIGH quality, baseline 2/2 PASS, candidate 2/2 FAIL", () => {
  const d = readSnapshot();
  assert.deepEqual(d.diagnosis, { type: "main_effect", factors: ["contextPolicy"] });
  assert.equal(d.stability.evidenceQuality, "high");
  assert.deepEqual(d.changedDimensions.slice().sort(), ["contextPolicy", "skills"]);
  assert.deepEqual(d.baselineAggregate.runs.map((r) => r.success), [true, true]);
  assert.deepEqual(d.candidateAggregate.runs.map((r) => r.success), [false, false]);
});

test("trace findings are computed from recorded trajectories", () => {
  const f = computeTraceFindings(readSnapshot());
  assert.ok(f);
  // Baseline: no compaction, no marker reads, tested in both runs.
  assert.equal(f.baseline.runsWithCompaction, 0);
  assert.equal(f.baseline.runsWithMarkerReads, 0);
  assert.equal(f.baseline.runsThatRanTests, 2);
  // Candidate: compaction and marker reads in both runs, never ran the tests.
  assert.equal(f.candidate.runsWithCompaction, 2);
  assert.equal(f.candidate.runsWithMarkerReads, 2);
  assert.equal(f.candidate.runsThatRanTests, 0);
  // The single-dimension control (baseline skill + candidate context) fails the same way.
  assert.equal(f.isolating.length, 1);
  assert.equal(f.isolating[0].passCount, 0);
  assert.equal(f.isolating[0].runsWithMarkerReads, 2);
  // Every failing run lost a file after compaction; the contract file is compacted 2021 -> 75 chars at turn 4 in run 1051883a.
  assert.equal(f.failingRuns, 4);
  assert.equal(f.failingRunsWithLostFile, 4);
  const run = f.candidate.runs.find((r) => r.runId.startsWith("1051883a"));
  assert.ok(run);
  const event = run.compactions.find((c) => c.identifier === "src/rankingContract.ts");
  assert.deepEqual(event && [event.turn, event.originalChars, event.compactedChars], [4, 2021, 75]);
  assert.equal(run.markerReads.filter((m) => m.path === "src/rankingContract.ts").length, 4);
  assert.equal(run.firstWriteTurn, 4);
  assert.deepEqual(run.compactedAtFirstWrite, ["src/rankingContract.ts"]);
});

test("trace findings return null instead of throwing when the evidence has no trajectories", () => {
  const d = readSnapshot();
  assert.equal(computeTraceFindings({ ...d, baselineAggregate: { ...d.baselineAggregate, runs: [] } }), null);
  assert.equal(computeTraceFindings({ ...d, aggregates: undefined } as unknown as StableDiagnosisResult), null);
});

test("the claim audit is bound to this exact diagnosis", () => {
  const audit = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, "claim-audit.json"), "utf8")) as { diagnosisId: string; claims: { verdict: string }[] };
  assert.equal(audit.diagnosisId, readSnapshot().diagnosisId);
  assert.ok(audit.claims.some((c) => c.verdict === "inferred"), "the audit must distinguish inferred claims from observed ones");
});

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harnesslab-locate-"));
}

test("locator finds evidence by content after the file is renamed", () => {
  const dir = tmpDir();
  fs.copyFileSync(snapshotPath, path.join(dir, "totally-different-name.json"));
  const entry = findDemoEvidence("applypilot");
  assert.ok(entry?.locate);
  assert.equal(locateEvidenceFile(entry.locate, [dir]), path.join(dir, "totally-different-name.json"));
});

test("locator ignores non-diagnosis json and other experiments", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "provenance.json"), JSON.stringify({ note: "x" }));
  fs.writeFileSync(path.join(dir, "broken.json"), "{not json");
  const other = readSnapshot();
  other.taskId = "some-other-task";
  fs.writeFileSync(path.join(dir, "other.json"), JSON.stringify(other));
  const entry = findDemoEvidence("applypilot");
  assert.ok(entry?.locate);
  assert.equal(locateEvidenceFile(entry.locate, [dir]), null);
});

test("locator prefers the frozen snapshot directory, then a clean regression over an unstable attempt", () => {
  const frozen = tmpDir();
  const live = tmpDir();
  fs.copyFileSync(snapshotPath, path.join(frozen, "a.json"));
  // A newer live run with the same quality must not displace the frozen snapshot.
  fs.copyFileSync(snapshotPath, path.join(live, "newer.json"));
  const entry = findDemoEvidence("applypilot");
  assert.ok(entry?.locate);
  assert.equal(locateEvidenceFile(entry.locate, [frozen, live]), path.join(frozen, "a.json"));

  // Within one directory, an unstable inconclusive attempt (synthetic test input) loses to the clean regression.
  const unstable = readSnapshot();
  unstable.regressionDetected = false;
  unstable.diagnosis = { type: "inconclusive", reason: "synthetic" };
  unstable.stability.evidenceQuality = "low";
  const same = tmpDir();
  fs.writeFileSync(path.join(same, "z-unstable-newest.json"), JSON.stringify(unstable));
  fs.copyFileSync(snapshotPath, path.join(same, "clean.json"));
  assert.equal(locateEvidenceFile(entry.locate, [same]), path.join(same, "clean.json"));
});

test("replay loads with no API key and with network calls forbidden", () => {
  const savedKey = process.env.NEBIUS_API_KEY;
  const savedFetch = globalThis.fetch;
  delete process.env.NEBIUS_API_KEY;
  globalThis.fetch = (() => {
    throw new Error("replay must not make network calls");
  }) as typeof fetch;
  try {
    const loaded = loadDiagnosisForDemo("applypilot");
    assert.equal(loaded.activeKey, "applypilot");
    assert.equal(loaded.replay, true);
    assert.ok(loaded.framing, "ApplyPilot entry must carry the derived-evaluation framing");
    assert.ok(loaded.findings);
    assert.ok(loaded.claimAudit, "audit must attach to the matching diagnosis");
    assert.equal(loaded.vm.diagnosis.type, "main_effect");
    assert.equal(loaded.vm.baseline.result, "PASS");
    assert.equal(loaded.vm.candidate.result, "FAIL");
    assert.equal(loaded.vm.dimensionChanges.length, 2);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey !== undefined) process.env.NEBIUS_API_KEY = savedKey;
  }
});

test("existing demos keep their fixed pointers and carry no ApplyPilot framing", () => {
  for (const entry of DEMO_EVIDENCE.filter((e) => e.key !== "applypilot")) {
    assert.equal(entry.locate, undefined, `${entry.key} must keep resolving by its original filePath`);
    assert.equal(entry.framing, undefined, `${entry.key} must not show the ApplyPilot banner`);
    assert.match(entry.filePath, /\.harnesslab[\\/]diagnoses[\\/][0-9a-f-]{36}\.json$/);
  }
  // Those entries only render where the (git-ignored) evidence exists; when it does, they must still load unchanged.
  for (const entry of DEMO_EVIDENCE.filter((e) => e.key !== "applypilot" && fs.existsSync(e.filePath))) {
    const loaded = loadDiagnosisForDemo(entry.key);
    assert.equal(loaded.sourceFilePath, entry.filePath);
    assert.equal(loaded.framing, null);
  }
});

test("the replay path never imports the Token Factory client", () => {
  const files = [
    "src/lib/demo/load-diagnosis.ts",
    "src/lib/demo/locate-evidence.ts",
    "src/lib/demo/trace-findings.ts",
    "src/components/diagnosis/ReplayEvidence.tsx",
    "scripts/demo-replay.ts",
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
    assert.doesNotMatch(src, /from\s+["'][^"']*nebius[^"']*["']/i, `${f} must not import the Nebius client`);
  }
});

test("the default page renders from tracked evidence alone, and unavailable keys fall back instead of crashing", () => {
  const savedEnv = process.env.HARNESSLAB_DEMO_DIAGNOSIS;
  delete process.env.HARNESSLAB_DEMO_DIAGNOSIS;
  try {
    assert.equal(DEFAULT_DEMO_EVIDENCE_KEY, "applypilot");
    // The default's evidence is tracked in git, so a fresh clone (no git-ignored .harnesslab/) can render it.
    const entry = DEMO_EVIDENCE.find((e) => e.key === DEFAULT_DEMO_EVIDENCE_KEY)!;
    assert.ok(isEvidenceAvailable(entry));
    assert.match(path.relative(process.cwd(), locateEvidenceFile(entry.locate!)!), /^demo-evidence[\\/]/);

    const byDefault = loadDiagnosisForDemo(undefined);
    assert.equal(byDefault.activeKey, "applypilot");
    assert.equal(loadDiagnosisForDemo("no-such-key").activeKey, "applypilot");

    // The switcher lists only entries that can actually render here.
    assert.ok(byDefault.catalog.length >= 1);
    assert.ok(byDefault.catalog.every(isEvidenceAvailable));
    for (const e of DEMO_EVIDENCE.filter((e) => !isEvidenceAvailable(e))) {
      assert.equal(loadDiagnosisForDemo(e.key).activeKey, "applypilot", `${e.key} has no evidence here and must fall back`);
    }
  } finally {
    if (savedEnv !== undefined) process.env.HARNESSLAB_DEMO_DIAGNOSIS = savedEnv;
  }
});
