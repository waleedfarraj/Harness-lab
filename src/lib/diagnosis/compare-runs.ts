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
  count: number;
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
 * Milestone 5/6's `DiagnosisResult` and Milestone 7's `StableDiagnosisResult`
 * — both share `taskId` and `diagnosis`, so this works for either) and tallies
 * how often each final classification occurred. Does not build a database;
 * this is purely a read over `.harnesslab/diagnoses/*.json`. Corrupt or
 * unrelated files are skipped, not thrown on, since this directory is meant
 * to be freely browsable evidence, not a strict schema.
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
    const entry = counts.get(label) ?? { label, count: 0, diagnosisIds: [] };
    entry.count += 1;
    entry.diagnosisIds.push(parsed.diagnosisId);
    counts.set(label, entry);
  }

  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Human-readable "2/3 interaction, 1/3 context main effect"-style summary, for CLI/report output. */
export function formatDiagnosisAgreement(entries: DiagnosisAgreementEntry[]): string {
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  if (total === 0) return "(no prior diagnosis evidence found for this task)";
  return entries.map((e) => `${e.count}/${total} ${e.label}`).join("\n");
}
