import "server-only";

import type { HarnessDimension, HarnessManifest } from "../harness/types";
import type { CodingTask } from "../experiments/types";
import type { ReplicationPolicy } from "../diagnosis/types";

/**
 * Metadata-only, per the benchmark brief: `expectedShape` is never read by
 * the diagnosis engine or the planner — it exists purely so this file's
 * author can state, up front and in writing, what each scenario was
 * designed to demonstrate, before the real (stochastic) result comes in.
 * Benchmark reporting compares the real result against this honestly; it
 * never feeds back into how a case is run.
 */
export type ExpectedShape = "main_effect" | "interaction" | "no_regression" | "unstable";

export interface BenchmarkCase {
  id: string;
  name: string;
  description: string;
  task: CodingTask;
  baseline: HarnessManifest;
  candidate: HarnessManifest;
  replication: ReplicationPolicy;
  expectedShape: ExpectedShape;
  /**
   * When set, this case reuses an already-recorded real `.harnesslab/diagnoses/*.json`
   * file instead of spending a fresh run budget — used for the scenario
   * where several prior real runs already produced the same honest result
   * (see cases.ts's comment on the "distractor-heavy" / stochastic case).
   */
  existingEvidencePath?: string;
  /**
   * Evaluation metadata only (never read by the planner, the diagnosis
   * engine, or anything the coding agent/Nemotron sees) — marks a case as a
   * deliberately seeded harness regression (fault injection) rather than a
   * natural exploratory sample, so benchmark reporting can keep it out of
   * the "accuracy" aggregate and present it as its own honestly-labeled
   * group (see report.ts and the benchmark brief, section 15).
   */
  controlledSeeded?: boolean;
  /**
   * Evaluation metadata only, stated before the real run — the harness
   * dimension(s) this seeded case was designed to make the sole true cause.
   * Compared against the real diagnosis after the fact for honest reporting;
   * never supplied to the diagnosis engine (see report.ts's heroQualified
   * computation, which reads the real `StableDiagnosisResult` only).
   */
  expectedFactors?: HarnessDimension[];
  /**
   * Evaluation metadata only — the stable, demo-facing id for a controlled
   * seeded case once it's been run (e.g. "hero-main-effect-v1"), independent
   * of its internal case id/description. Never read by the diagnosis engine.
   */
  heroCaseId?: string;
}
