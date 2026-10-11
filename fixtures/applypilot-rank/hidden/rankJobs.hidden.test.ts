import assert from "node:assert/strict";
import { test } from "node:test";
import { rankJobs } from "../src/rankJobs";
import type { Eligibility, RankableJob, Recommendation } from "../src/rankingContract";

/**
 * Evaluator-only tests. Not shown to the coding agent while it works. They check the rules stated only in
 * rankingContract.ts: eligibility outranks score within a tier, pending jobs go last, and ties break on
 * major gaps then id.
 */

function job(id: string, recommendation: Recommendation, score: number, eligibility: Eligibility = "eligible", majorGapCount = 0): RankableJob {
  return { id, title: `Role ${id}`, status: "evaluated", recommendation, score, eligibility, majorGapCount };
}
const pending = (id: string): RankableJob => ({ id, title: `Role ${id}`, status: "pending" });
const ids = (jobs: RankableJob[]) => jobs.map((j) => j.id);

test("a not_eligible job never outranks an eligible job in the same tier, however high its score", () => {
  const ranked = rankJobs([job("blocked", "STRETCH", 99, "not_eligible"), job("ok", "STRETCH", 50)]);
  assert.deepEqual(ids(ranked), ["ok", "blocked"]);
});

test("unconfirmed eligibility ranks between eligible/not_stated and not_eligible", () => {
  const ranked = rankJobs([
    job("blocked", "STRETCH", 95, "not_eligible"),
    job("unconfirmed", "STRETCH", 90, "unconfirmed"),
    job("not-stated", "STRETCH", 60, "not_stated"),
    job("eligible", "STRETCH", 55, "eligible"),
  ]);
  assert.deepEqual(ids(ranked), ["not-stated", "eligible", "unconfirmed", "blocked"]);
});

test("recommendation tier still outranks eligibility", () => {
  const ranked = rankJobs([job("stretch-ok", "STRETCH", 99), job("apply-blocked", "APPLY", 10, "not_eligible")]);
  assert.deepEqual(ids(ranked), ["apply-blocked", "stretch-ok"]);
});

test("pending jobs rank after every evaluated job, ordered by id", () => {
  const ranked = rankJobs([pending("p2"), job("skip", "SKIP", 1, "not_eligible"), pending("p1"), job("apply", "APPLY", 80)]);
  assert.deepEqual(ids(ranked), ["apply", "skip", "p1", "p2"]);
});

test("equal score: fewer major gaps first, then id ascending", () => {
  const ranked = rankJobs([job("c", "APPLY", 70, "eligible", 0), job("a", "APPLY", 70, "eligible", 2), job("b", "APPLY", 70, "eligible", 0)]);
  assert.deepEqual(ids(ranked), ["b", "c", "a"]);
});
