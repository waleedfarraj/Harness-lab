import type { AggregateViewModel, DiagnosisViewModel } from "@/lib/view-model/types";
import { Card, Disclosure } from "./primitives";
import { STATUS_BADGE_CLASS, evidenceQualityClass } from "./status";
import { RunEvidenceDetails } from "./RunEvidenceDetails";

function outcomeSequence(agg: AggregateViewModel): string {
  return agg.runs.map((r) => (r.success ? "PASS" : "FAIL")).join("  ·  ");
}

function stabilityDescription(agg: AggregateViewModel): string {
  if (agg.stability === "mostly_pass") return "Mostly pass";
  if (agg.stability === "mostly_fail") return "Mostly fail";
  return "Unstable — disagreeing runs";
}

function AggregateRow({ agg }: { agg: AggregateViewModel }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{agg.bits}</span>
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{agg.label}</span>
          {agg.isDecisionCritical && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">decision-critical</span>}
        </div>
        <div className="flex items-center gap-2">
          {agg.evidenceMaturity && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{agg.evidenceMaturity}</span>
          )}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${agg.stability === "unstable" ? STATUS_BADGE_CLASS.unstable : agg.stability === "mostly_pass" ? STATUS_BADGE_CLASS.pass : STATUS_BADGE_CLASS.fail}`}>
            {stabilityDescription(agg)}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-mono text-zinc-600 dark:text-zinc-400">{outcomeSequence(agg)}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-500">Failure rate {agg.failureRatePct}% over {agg.runs.length} run{agg.runs.length === 1 ? "" : "s"}</span>
      </div>

      <Disclosure summary={`Runs (${agg.runs.length})`} className="mt-2">
        <div className="space-y-2">
          {agg.runs.map((run) => (
            <RunEvidenceDetails key={run.runId} run={run} />
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

export function StabilityPanel({ aggregates, stability, schemaSource }: { aggregates: AggregateViewModel[]; stability: DiagnosisViewModel["stability"]; schemaSource: DiagnosisViewModel["schemaSource"] }) {
  return (
    <Card className="p-5 sm:p-6">
      {stability ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-800">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">Evidence quality</p>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{stability.reason}</p>
          </div>
          <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-sm font-semibold uppercase tracking-wide ${evidenceQualityClass(stability.evidenceQuality)}`}>
            {stability.evidenceQuality}
          </span>
        </div>
      ) : (
        <p className="mb-4 border-b border-zinc-100 pb-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
          Single-run evidence — this diagnosis predates replication/stability tracking, so each configuration was only observed once.
        </p>
      )}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {aggregates.map((agg) => (
          <AggregateRow key={agg.bits} agg={agg} />
        ))}
      </div>
      {schemaSource === "legacy" && <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-600">Milestone 6 evidence — no replication policy was in effect when this ran.</p>}
    </Card>
  );
}
