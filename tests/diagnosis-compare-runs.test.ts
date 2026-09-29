import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { diagnosisLabel, formatDiagnosisAgreement, summarizeDiagnosisAgreement } from "../src/lib/diagnosis/compare-runs";
import type { Diagnosis } from "../src/lib/diagnosis/types";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harnesslab-compare-"));
}

function writeDiagnosisFile(dir: string, id: string, taskId: string, diagnosis: Diagnosis) {
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ diagnosisId: id, taskId, diagnosis }), "utf8");
}

test("diagnosisLabel: formats main_effect, interaction, and inconclusive distinctly", () => {
  assert.equal(diagnosisLabel({ type: "main_effect", factors: ["contextPolicy"] }), "contextPolicy");
  assert.equal(diagnosisLabel({ type: "interaction", factors: ["skills", "contextPolicy"] }), "skills x contextPolicy");
  assert.equal(diagnosisLabel({ type: "inconclusive", reason: "whatever" }), "inconclusive");
});

test("summarizeDiagnosisAgreement: tallies only files matching the given taskId, grouped by classification", () => {
  const dir = tmpDir();
  try {
    writeDiagnosisFile(dir, "run-1", "discount-apply-001", { type: "interaction", factors: ["skills", "contextPolicy"] });
    writeDiagnosisFile(dir, "run-2", "discount-apply-001", { type: "main_effect", factors: ["contextPolicy"] });
    writeDiagnosisFile(dir, "run-3", "discount-apply-001", { type: "interaction", factors: ["skills", "contextPolicy"] });
    writeDiagnosisFile(dir, "run-unrelated", "some-other-task", { type: "main_effect", factors: ["skills"] });

    const entries = summarizeDiagnosisAgreement("discount-apply-001", dir);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].label, "skills x contextPolicy");
    assert.equal(entries[0].diagnosisAttempts, 2);
    assert.deepEqual(entries[0].diagnosisIds.sort(), ["run-1", "run-3"]);
    assert.equal(entries[1].label, "contextPolicy");
    assert.equal(entries[1].diagnosisAttempts, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("summarizeDiagnosisAgreement: skips corrupt or unrelated JSON files instead of throwing", () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, "corrupt.json"), "{ not valid json", "utf8");
    fs.writeFileSync(path.join(dir, "unrelated-shape.json"), JSON.stringify({ hello: "world" }), "utf8");
    writeDiagnosisFile(dir, "run-1", "t", { type: "main_effect", factors: ["skills"] });

    const entries = summarizeDiagnosisAgreement("t", dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].diagnosisAttempts, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("summarizeDiagnosisAgreement: returns an empty array for a directory that doesn't exist", () => {
  assert.deepEqual(summarizeDiagnosisAgreement("t", path.join(os.tmpdir(), "harnesslab-does-not-exist-" + Date.now())), []);
});

test("formatDiagnosisAgreement: renders 'x/total diagnosis attempts -> label' lines (never implying a coding-agent-run count), and a friendly message when there's nothing to compare", () => {
  assert.equal(formatDiagnosisAgreement([]), "(no prior diagnosis evidence found for this task)");
  const text = formatDiagnosisAgreement([
    { label: "skills x contextPolicy", diagnosisAttempts: 2, diagnosisIds: ["a", "b"] },
    { label: "contextPolicy", diagnosisAttempts: 1, diagnosisIds: ["c"] },
  ]);
  assert.equal(text, "2/3 diagnosis attempts -> skills x contextPolicy\n1/3 diagnosis attempts -> contextPolicy");
});
