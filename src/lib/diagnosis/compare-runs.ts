import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DIAGNOSES_DIR } from "../experiments/evidence";
import type { Diagnosis } from "./types";

interface StoredDiagnosisShape {
  diagnosisId: string;
  taskId: string;
  diagnosis: Diagnosis;
}

export interface DiagnosisAgreementEntry {
  label: string;
  /**
   * Number of diagnosis ATTEMPTS (i.e. `.harnesslab/diagnoses/*.json` evidence
   * files) that reached this classification — NOT a count of coding-agent
   * executions. One diagnosis attempt is one call to `runDiagnosis`/
   * `runStableDiagnosis` and may itself have consumed anywhere from 2 (an
   * early single-run M5/M6 diagnosis) to 10+ (a replicated M7/M8 diagnosis)
   * individual coding-agent runs. See Milestone 8's completion report for
   * why this distinction matters — an earlier report conflated the two.
   */
  diagnosisAttempts: number;
  diagnosisIds: string[];
}

/** A short, stable label for a `Diagnosis`, used purely for grouping — not stored anywhere. */
export function diagnosisLabel(diagnosis: Diagnosis): string {
  if (diagnosis.type === "main_effect") return diagnosis.factors.join(", ");
  if (diagnosis.type === "interaction") return diagnosis.factors.join(" x ");
  return "inconclusive";
}

/**
 * Reads every local diagnosis evidence JSON file for `taskId` (both
 * Milestone 5/6's `DiagnosisResult` and Milestone 7/8's `StableDiagnosisResult`
 * — both share `taskId` and `diagnosis`, so this works for either) and tallies
 * how many DIAGNOSIS ATTEMPTS (evidence files) reached each final
 * classification. Does not build a database; this is purely a read over
 * `.harnesslab/diagnoses/*.json`. Corrupt or unrelated files are skipped,
 * not thrown on, since this directory is meant to be freely browsable
 * evidence, not a strict schema.
 *
 * IMPORTANT: this counts diagnosis ATTEMPTS, never coding-agent executions.
 * A single M7/M8 diagnosis attempt can itself contain 10+ real coding-agent
 * runs; summing `diagnosisAttempts` across entries is never a valid proxy
 * for total coding-agent calls made. See `DiagnosisAgreementEntry`.
 */
export function summarizeDiagnosisAgreement(taskId: string, diagnosesDir: string = DIAGNOSES_DIR): DiagnosisAgreementEntry[] {
  let files: string[];
  try {
    files = fs.readdirSync(diagnosesDir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const counts = new Map<string, DiagnosisAgreementEntry>();
  for (const file of files) {
    let parsed: StoredDiagnosisShape;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(diagnosesDir, file), "utf8"));
    } catch {
      continue;
    }
    if (!parsed || parsed.taskId !== taskId || !parsed.diagnosis || typeof parsed.diagnosis.type !== "string") continue;

    const label = diagnosisLabel(parsed.diagnosis);
    const entry = counts.get(label) ?? { label, diagnosisAttempts: 0, diagnosisIds: [] };
    entry.diagnosisAttempts += 1;
    entry.diagnosisIds.push(parsed.diagnosisId);
    counts.set(label, entry);
  }

  return [...counts.values()].sort((a, b) => b.diagnosisAttempts - a.diagnosisAttempts || a.label.localeCompare(b.label));
}

/**
 * Human-readable "2/3 diagnosis attempts -> interaction"-style summary, for
 * CLI/report output. Deliberately spells out "diagnosis attempts" rather
 * than printing bare "X/Y label" — a bare number here was previously
 * misread as a coding-agent run count in a completion report; see
 * Milestone 8.
 */
export function formatDiagnosisAgreement(entries: DiagnosisAgreementEntry[]): string {
  const totalDiagnosisAttempts = entries.reduce((sum, e) => sum + e.diagnosisAttempts, 0);
  if (totalDiagnosisAttempts === 0) return "(no prior diagnosis evidence found for this task)";
  return entries.map((e) => `${e.diagnosisAttempts}/${totalDiagnosisAttempts} diagnosis attempts -> ${e.label}`).join("\n");
}
