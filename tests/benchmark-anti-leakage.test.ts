import assert from "node:assert/strict";
import { test } from "node:test";
import { BENCHMARK_CASES } from "../src/lib/benchmark/cases";

/**
 * Section 6 of the controlled-regression benchmark brief: the expected
 * answer (expectedShape / expectedFactors / controlledSeeded / heroCaseId)
 * is benchmark metadata only and must never reach the diagnosis planner,
 * Nemotron, the coding agent, mechanism explanation, the evaluator, or the
 * experiment selector. scripts/benchmark-run.ts and scripts/benchmark-calibrate.ts
 * both build the request as `{ task, baseline, candidate, replication }` —
 * this test locks that shape down so a future edit can't widen it to also
 * spread `bc` (and its metadata fields) into the request.
 */
test("benchmark metadata fields never leak into the StableDiagnosisRequest shape", () => {
  for (const bc of BENCHMARK_CASES) {
    const request = { task: bc.task, baseline: bc.baseline, candidate: bc.candidate, replication: bc.replication };

    assert.ok(!("expectedShape" in request), `${bc.id}: request object must not carry expectedShape`);
    assert.ok(!("controlledSeeded" in request), `${bc.id}: request object must not carry controlledSeeded`);
    assert.ok(!("expectedFactors" in request), `${bc.id}: request object must not carry expectedFactors`);
    assert.ok(!("heroCaseId" in request), `${bc.id}: request object must not carry heroCaseId`);
  }
});

test("BenchmarkCase metadata fields (expectedShape, controlledSeeded, expectedFactors, heroCaseId) are absent from HarnessManifest and CodingTask", () => {
  for (const bc of BENCHMARK_CASES) {
    for (const manifest of [bc.baseline, bc.candidate]) {
      assert.ok(!("expectedShape" in manifest), `${bc.id}: manifest must not carry expectedShape`);
      assert.ok(!("controlledSeeded" in manifest), `${bc.id}: manifest must not carry controlledSeeded`);
      assert.ok(!("expectedFactors" in manifest), `${bc.id}: manifest must not carry expectedFactors`);
    }
    assert.ok(!("expectedShape" in bc.task), `${bc.id}: task must not carry expectedShape`);
    assert.ok(!("controlledSeeded" in bc.task), `${bc.id}: task must not carry controlledSeeded`);
  }
});
