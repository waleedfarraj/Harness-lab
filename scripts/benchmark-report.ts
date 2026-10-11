// Aggregates every .harnesslab/benchmark/<caseId>.json produced by
// benchmark-run.ts into one machine-readable report.json and a human-readable
// report.md (section 8 of the benchmark brief). Reads only what each case
// result already contains — computes no new diagnosis-engine metrics.
import fs from "node:fs";
import path from "node:path";
import { BENCHMARK_CASES } from "../src/lib/benchmark/cases";
import { buildAggregateReport, formatAggregateReportMarkdown, type BenchmarkCaseReport } from "../src/lib/benchmark/report";

const BENCHMARK_DIR = path.join(process.cwd(), ".harnesslab", "benchmark");

function main() {
  const caseReports: BenchmarkCaseReport[] = [];
  const missing: string[] = [];

  for (const bc of BENCHMARK_CASES) {
    const filePath = path.join(BENCHMARK_DIR, `${bc.id}.json`);
    if (!fs.existsSync(filePath)) {
      missing.push(bc.id);
      continue;
    }
    caseReports.push(JSON.parse(fs.readFileSync(filePath, "utf8")) as BenchmarkCaseReport);
  }

  if (missing.length > 0) {
    console.log(`Note: ${missing.length} case(s) have no recorded result yet and are excluded from this report: ${missing.join(", ")}`);
    console.log(`Run: node --conditions=react-server --env-file=.env.local --import tsx scripts/benchmark-run.ts --case=<id>\n`);
  }

  const report = buildAggregateReport(caseReports);
  fs.mkdirSync(BENCHMARK_DIR, { recursive: true });

  const jsonPath = path.join(BENCHMARK_DIR, "report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const mdPath = path.join(BENCHMARK_DIR, "report.md");
  fs.writeFileSync(mdPath, formatAggregateReportMarkdown(report), "utf8");

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`\n${formatAggregateReportMarkdown(report)}`);
}

main();
