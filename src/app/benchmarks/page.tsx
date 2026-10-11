import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { Section, Card, Badge, Mono, Stat } from "@/components/diagnosis/primitives";
import type { AggregateBenchmarkReport } from "@/lib/benchmark/report";

const REPORT_PATH = path.join(process.cwd(), ".harnesslab", "benchmark", "report.json");

function diagnosisLabel(diagnosis: AggregateBenchmarkReport["cases"][number]["diagnosis"]): string {
  if (diagnosis.type === "main_effect") return `Main effect: ${diagnosis.factors.join(", ")}`;
  if (diagnosis.type === "interaction") return `Interaction: ${diagnosis.factors.join(" x ")}`;
  return "Inconclusive";
}

function badgeClass(diagnosisType: string): string {
  if (diagnosisType === "main_effect" || diagnosisType === "interaction") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

export default function BenchmarksPage() {
  if (!fs.existsSync(REPORT_PATH)) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">No benchmark report yet</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Run <Mono className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">scripts/benchmark-run.ts</Mono> for each case, then{" "}
          <Mono className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">scripts/benchmark-report.ts</Mono>.
        </p>
      </main>
    );
  }

  const report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8")) as AggregateBenchmarkReport;

  return (
    <main>
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-6xl px-6 pt-10 pb-6">
          <Link href="/" className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200">
            ← Back to diagnosis
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">HarnessLab benchmark</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">Generated {new Date(report.generatedAt).toLocaleString()}. No statistical significance claimed.</p>
        </div>
      </header>

      <Section eyebrow="Aggregate" title="Across all cases">
        <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Cases" value={report.totals.casesRun} />
          <Stat label="Regressions reproduced" value={`${report.totals.regressionsReproduced} / ${report.totals.casesRun}`} />
          <Stat label="Decisive diagnoses" value={report.totals.decisiveDiagnoses} hint={`${report.totals.decisiveDiagnosesAmongRegressions} of reproduced regressions`} />
          <Stat label="Correctly inconclusive" value={report.totals.correctlyInconclusive} />
          <Stat label="Avg. search-space reduction" value={`${report.totals.averageSearchSpaceReductionPct}%`} />
          <Stat label="Total coding-agent runs" value={report.totals.totalCodingAgentExecutions} />
          <Stat label="Total tokens" value={`${report.totals.totalInputTokens.toLocaleString()} in / ${report.totals.totalOutputTokens.toLocaleString()} out`} />
        </dl>
      </Section>

      <Section eyebrow="Cases" title="Natural / exploratory benchmark cases" subtitle="expectedShape is benchmark-design metadata only — the diagnosis engine never sees it.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
                <th className="py-2 pr-4">Case</th>
                <th className="py-2 pr-4">Task</th>
                <th className="py-2 pr-4">Dims</th>
                <th className="py-2 pr-4">Expected</th>
                <th className="py-2 pr-4">Diagnosis</th>
                <th className="py-2 pr-4">Evidence quality</th>
                <th className="py-2 pr-4">Runs</th>
                <th className="py-2 pr-4">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {report.cases.map((c) => (
                <tr key={c.caseId} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                  <td className="py-2 pr-4 font-medium text-zinc-900 dark:text-zinc-100">{c.name}</td>
                  <td className="py-2 pr-4">
                    <Mono className="text-xs text-zinc-600 dark:text-zinc-400">{c.taskId}</Mono>
                  </td>
                  <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{c.changedDimensions.length}</td>
                  <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{c.expectedShape}</td>
                  <td className="py-2 pr-4">
                    <Badge className={badgeClass(c.diagnosis.type)}>{diagnosisLabel(c.diagnosis)}</Badge>
                  </td>
                  <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{c.evidenceQuality}</td>
                  <td className="py-2 pr-4">
                    <Mono>
                      {c.totalCodingRuns}
                      {c.reusedExistingEvidence ? " (reused)" : ""}
                    </Mono>
                  </td>
                  <td className="py-2 pr-4">
                    <Mono className="text-xs">
                      {c.totalInputTokens.toLocaleString()} / {c.totalOutputTokens.toLocaleString()}
                    </Mono>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        eyebrow="Controlled seeded benchmark"
        title="Deliberately seeded harness regressions"
        subtitle="Fault injection, not a natural sample — kept out of the aggregate above and reported with an explicit hero-qualification verdict."
      >
        <div className="space-y-4">
          {report.controlledSeededCases.map((c) => (
            <Card key={c.caseId} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{c.name}</div>
                  {c.heroCaseId && <Mono className="text-xs text-zinc-500">{c.heroCaseId}</Mono>}
                </div>
                <Badge className={c.heroQualified ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"}>
                  {c.heroQualified ? "Hero qualified" : "Did not qualify"}
                </Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400 sm:grid-cols-4">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-zinc-400">Task</dt>
                  <dd>
                    <Mono className="text-xs">{c.taskId}</Mono>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-zinc-400">Changed dims</dt>
                  <dd>{c.changedDimensions.join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-zinc-400">Expected factor(s)</dt>
                  <dd>{c.expectedFactors?.join(", ") ?? "(none stated)"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-zinc-400">Diagnosis</dt>
                  <dd>
                    <Badge className={badgeClass(c.diagnosis.type)}>{diagnosisLabel(c.diagnosis)}</Badge>
                  </dd>
                </div>
              </dl>
              {!c.heroQualified && (
                <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                  <div className="text-xs uppercase tracking-wide text-zinc-400">Why it didn&apos;t qualify</div>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {c.heroQualificationFailures.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          ))}
        </div>
      </Section>

      <Card className="mx-auto mb-12 max-w-6xl p-6 text-sm text-zinc-600 dark:text-zinc-400">
        Full per-case evidence files live in <Mono className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.harnesslab/benchmark/</Mono> and{" "}
        <Mono className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.harnesslab/diagnoses/</Mono>. See the evidence switcher on the{" "}
        <Link href="/" className="underline">
          diagnosis page
        </Link>{" "}
        for the &quot;No regression&quot; and &quot;Inconclusive (unstable evidence)&quot; results this benchmark run added.
      </Card>
    </main>
  );
}
