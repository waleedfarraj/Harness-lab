import assert from "node:assert/strict";
import { test } from "node:test";
import { rankJobs } from "../src/rankJobs";
import type { RankableJob, Recommendation } from "../src/rankingContract";

function job(id: string, recommendation: Recommendation, score: number): RankableJob {
  return { id, title: `Role ${id}`, status: "evaluated", recommendation, score, eligibility: "eligible", majorGapCount: 0 };
}

const ids = (jobs: RankableJob[]) => jobs.map((j) => j.id);

test("ranks APPLY above STRETCH above SKIP", () => {
  const ranked = rankJobs([job("skip", "SKIP", 95), job("stretch", "STRETCH", 70), job("apply", "APPLY", 60)]);
  assert.deepEqual(ids(ranked), ["apply", "stretch", "skip"]);
});

test("within a recommendation tier, higher score ranks first", () => {
  const ranked = rankJobs([job("low", "STRETCH", 50), job("high", "STRETCH", 80), job("mid", "STRETCH", 65)]);
  assert.deepEqual(ids(ranked), ["high", "mid", "low"]);
});

test("does not mutate its input", () => {
  const input = [job("b", "SKIP", 10), job("a", "APPLY", 90)];
  rankJobs(input);
  assert.deepEqual(ids(input), ["b", "a"]);
});
