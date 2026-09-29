import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { DiagnosisResult, StableDiagnosisResult } from "../diagnosis/types";
import type { HarnessComparison } from "./compare";
import type { FactorialInteractionResult } from "./interaction";
import type { ExperimentResult } from "./types";

const RUNS_DIR = path.join(process.cwd(), ".harnesslab", "runs");
const COMPARISONS_DIR = path.join(process.cwd(), ".harnesslab", "comparisons");
const INTERACTIONS_DIR = path.join(process.cwd(), ".harnesslab", "interactions");
export const DIAGNOSES_DIR = path.join(process.cwd(), ".harnesslab", "diagnoses");

/** Local JSON evidence file per run. Never includes the API key or the full process environment. */
export function writeRunEvidence(result: ExperimentResult): string {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const filePath = path.join(RUNS_DIR, `${result.runId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), "utf8");
  return filePath;
}

/** Local JSON evidence file per comparison, containing both full ExperimentResults and the derived delta. */
export function writeComparisonEvidence(comparison: HarnessComparison): string {
  fs.mkdirSync(COMPARISONS_DIR, { recursive: true });
  const filePath = path.join(COMPARISONS_DIR, `${comparison.comparisonId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(comparison, null, 2), "utf8");
  return filePath;
}

/** Local JSON evidence file per factorial interaction experiment, containing all four cells' full ExperimentResults. */
export function writeInteractionEvidence(interaction: FactorialInteractionResult): string {
  fs.mkdirSync(INTERACTIONS_DIR, { recursive: true });
  const filePath = path.join(INTERACTIONS_DIR, `${interaction.interactionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(interaction, null, 2), "utf8");
  return filePath;
}

/** Local JSON evidence file per diagnosis run, containing baseline/candidate/diagnostic results and the final classification. */
export function writeDiagnosisEvidence(diagnosis: DiagnosisResult): string {
  fs.mkdirSync(DIAGNOSES_DIR, { recursive: true });
  const filePath = path.join(DIAGNOSES_DIR, `${diagnosis.diagnosisId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(diagnosis, null, 2), "utf8");
  return filePath;
}

/**
 * Local JSON evidence file per Milestone 7 replicated (stable) diagnosis run.
 * Written to the same `.harnesslab/diagnoses/` directory as `writeDiagnosisEvidence`
 * (both share `taskId` + `diagnosis`), so `diagnosis/compare-runs.ts` can compare
 * agreement across every diagnosis run of a task regardless of which milestone produced it.
 */
export function writeStableDiagnosisEvidence(diagnosis: StableDiagnosisResult): string {
  fs.mkdirSync(DIAGNOSES_DIR, { recursive: true });
  const filePath = path.join(DIAGNOSES_DIR, `${diagnosis.diagnosisId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(diagnosis, null, 2), "utf8");
  return filePath;
}
