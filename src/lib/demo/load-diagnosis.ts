import "server-only";

import fs from "node:fs";
import path from "node:path";
import { toDiagnosisViewModel } from "../view-model/diagnosis-view-model";
import type { DiagnosisViewModel } from "../view-model/types";
import type { DiagnosisResult, StableDiagnosisResult } from "../diagnosis/types";
import { DEFAULT_DEMO_EVIDENCE_KEY, DEMO_EVIDENCE, findDemoEvidence, type DemoEvidenceEntry } from "./evidence-catalog";

export interface LoadedDiagnosisDemo {
  vm: DiagnosisViewModel;
  /** The catalog entry key that was actually rendered, or "custom" when `HARNESSLAB_DEMO_DIAGNOSIS` pointed at a file outside the catalog. */
  activeKey: string;
  catalog: DemoEvidenceEntry[];
  sourceFilePath: string;
}

export class DiagnosisEvidenceNotFoundError extends Error {
  constructor(filePath: string) {
    super(`No diagnosis evidence file at ${filePath}. Run one of the diagnose:* scripts first, or point HARNESSLAB_DEMO_DIAGNOSIS at an existing .harnesslab/diagnoses/*.json file.`);
    this.name = "DiagnosisEvidenceNotFoundError";
  }
}

/** Dev-only path resolution for an arbitrary `HARNESSLAB_DEMO_DIAGNOSIS` override — never bundled: this app has no production deployment target (see AGENTS.md/README). */
function resolveEnvPath(envValue: string): string {
  return path.isAbsolute(envValue) ? envValue : path.join(/* turbopackIgnore: true */ process.cwd(), envValue);
}

function contextFor(entry: DemoEvidenceEntry) {
  return { taskTitle: entry.taskTitle, taskInstruction: entry.taskInstruction, baselineManifest: entry.baselineManifest, candidateManifest: entry.candidateManifest };
}

/**
 * Resolution order: an explicit `?evidence=` query key wins; otherwise
 * `HARNESSLAB_DEMO_DIAGNOSIS` (a catalog key, or a literal path to any saved
 * evidence file — see the Milestone 12 spec); otherwise the default catalog
 * entry. A literal path outside the catalog still renders (dimension changes
 * degrade to baseline/candidate labels instead of literal harness values,
 * since only cataloged entries know which manifests produced them) — see
 * `diagnosis-view-model.test.ts`'s "missing optional metadata" coverage.
 */
export function loadDiagnosisForDemo(evidenceKeyParam?: string): LoadedDiagnosisDemo {
  const envValue = process.env.HARNESSLAB_DEMO_DIAGNOSIS?.trim();

  // Priority: ?evidence= query key > HARNESSLAB_DEMO_DIAGNOSIS as a catalog key > default catalog entry.
  // (HARNESSLAB_DEMO_DIAGNOSIS as a literal file path is handled below, once we know neither matched a catalog key.)
  const entry = (evidenceKeyParam && findDemoEvidence(evidenceKeyParam)) || (envValue && findDemoEvidence(envValue)) || undefined;

  let sourceFilePath: string;
  let activeKey: string;
  let ctx: ReturnType<typeof contextFor> | Record<string, never>;

  if (entry) {
    sourceFilePath = entry.filePath;
    activeKey = entry.key;
    ctx = contextFor(entry);
  } else if (envValue) {
    // HARNESSLAB_DEMO_DIAGNOSIS set to a literal file path, not a catalog key.
    sourceFilePath = resolveEnvPath(envValue);
    activeKey = "custom";
    ctx = {};
  } else {
    const fallback = findDemoEvidence(DEFAULT_DEMO_EVIDENCE_KEY)!;
    sourceFilePath = fallback.filePath;
    activeKey = fallback.key;
    ctx = contextFor(fallback);
  }

  if (!fs.existsSync(sourceFilePath)) throw new DiagnosisEvidenceNotFoundError(sourceFilePath);

  const raw = JSON.parse(fs.readFileSync(sourceFilePath, "utf8")) as StableDiagnosisResult | DiagnosisResult;
  const vm = toDiagnosisViewModel(raw, ctx);

  return { vm, activeKey, catalog: DEMO_EVIDENCE, sourceFilePath };
}
