// Runs ONE official benchmark case (section 6: "run it deliberately, not in
// a loop"). Reuses an already-recorded real diagnosis when the case says to
// (BenchmarkCase.existingEvidencePath — see cases.ts's Scenario D); otherwise
// makes exactly one real runStableDiagnosis call against the configured
// SandboxRunner (HARNESSLAB_RUNNER=token-factory for an official run). The
// diagnosis engine itself is untouched — this only assembles and persists
// the section-7 report fields that are already present on the result.
//
// Usage: node --conditions=react-server --env-file=.env.local --import tsx scripts/benchmark-run.ts --case=<id>
import fs from "node:fs";
import path from "node:path";
import { runStableDiagnosis } from "../src/lib/diagnosis/diagnose-stable";
import { resolveRunnerKind } from "../src/lib/sandbox/runner-config";
import { BENCHMARK_CASES } from "../src/lib/benchmark/cases";
import { buildCaseReport } from "../src/lib/benchmark/report";
import type { StableDiagnosisResult } from "../src/lib/diagnosis/types";

const BENCHMARK_DIR = path.join(process.cwd(), ".harnesslab", "benchmark");

async function main() {
  const caseIdArg = process.argv.find((a) => a.startsWith("--case="))?.split("=")[1];
  if (!caseIdArg) {
    console.error("Usage: scripts/benchmark-run.ts --case=<id>");
    console.error(`Known case ids: ${BENCHMARK_CASES.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  const bc = BENCHMARK_CASES.find((c) => c.id === caseIdArg);
  if (!bc) {
    console.error(`Unknown case id: ${caseIdArg}`);
    console.error(`Known case ids: ${BENCHMARK_CASES.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  console.log(`HarnessLab benchmark — case: ${bc.id}`);
  console.log(bc.name);
  console.log(bc.description);
  console.log(`Task: ${bc.task.id}`);
  console.log(`Expected shape (metadata only — never seen by the diagnosis engine): ${bc.expectedShape}\n`);

  let result: StableDiagnosisResult;
  let diagnosisFilePath: string;
  let reused = false;

  if (bc.existingEvidencePath) {
    console.log(`Reusing existing recorded evidence (no new run): ${bc.existingEvidencePath}`);
    if (!fs.existsSync(bc.existingEvidencePath)) {
      console.error(`existingEvidencePath does not exist: ${bc.existingEvidencePath}`);
      process.exit(1);
    }
    result = JSON.parse(fs.readFileSync(bc.existingEvidencePath, "utf8")) as StableDiagnosisResult;
    diagnosisFilePath = path.relative(process.cwd(), bc.existingEvidencePath);
    reused = true;
  } else {
    const runnerKind = resolveRunnerKind();
    console.log(`Runner: ${runnerKind}${runnerKind !== "token-factory" ? " (NOT an official run — set HARNESSLAB_RUNNER=token-factory for the real benchmark)" : ""}`);
    console.log(`Replication policy: minRuns=${bc.replication.minRunsPerConfiguration} maxRuns=${bc.replication.maxRunsPerConfiguration} maxTotalRuns=${bc.replication.maxTotalRuns} reservedConfirmationRuns=${bc.replication.reservedConfirmationRuns}\n`);

    result = await runStableDiagnosis({ task: bc.task, baseline: bc.baseline, candidate: bc.candidate, replication: bc.replication });
    diagnosisFilePath = path.join(".harnesslab", "diagnoses", `${result.diagnosisId}.json`);
  }

  console.log(`\nRegression detected: ${result.regressionDetected}`);
  console.log(`Diagnosis: ${JSON.stringify(result.diagnosis)}`);
  console.log(`Evidence quality: ${result.stability.evidenceQuality}`);
  console.log(`Total coding runs: ${result.totalCodingRuns}`);

  const report = buildCaseReport(bc, result, reused, diagnosisFilePath);

  fs.mkdirSync(BENCHMARK_DIR, { recursive: true });
  const outPath = path.join(BENCHMARK_DIR, `${bc.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nWrote ${outPath}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("benchmark-run failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
