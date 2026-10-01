import type { PlannerStepViewModel } from "@/lib/view-model/types";
import { Card, Disclosure } from "./primitives";
import { passFailBadgeClass } from "./status";
import { RunEvidenceDetails } from "./RunEvidenceDetails";
import { HypothesisPills } from "./HypothesisPills";

function TechnicalDetails({ step }: { step: PlannerStepViewModel }) {
  const t = step.technical;
  return (
    <Disclosure summary="Technical details" className="mt-3">
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-100 bg-zinc-50/60 p-3 text-xs sm:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-950/40">
        <TechStat label="Information score" value={t.informationScore} />
        <TechStat label="Decision criticality" value={t.decisionCriticality} />
        <TechStat label="Separator rarity" value={t.separatorRarityScore !== null ? t.separatorRarityScore.toFixed(3) : null} />
        <TechStat label="Rare pairs separated" value={t.rarePairsSeparated} />
        <TechStat label="Look-ahead risk" value={t.lookaheadRisk === null ? null : t.lookaheadRisk ? "yes" : "no"} />
        <TechStat label="Run budget remaining" value={t.remainingRunBudget} />
        <TechStat label="Reserved confirmation runs" value={t.reservedConfirmationRuns} />
      </dl>
    </Disclosure>
  );
}

function TechStat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <dt className="font-medium text-zinc-500">{label}</dt>
      <dd className="mt-0.5 tabular-nums text-zinc-700 dark:text-zinc-300">{value === null ? "n/a" : value}</dd>
    </div>
  );
}

function StepCard({ step }: { step: PlannerStepViewModel }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded-md bg-zinc-100 px-2.5 py-1 font-mono text-sm font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">{step.bits}</span>
          <span className="inline-flex items-center rounded-full bg-zinc-900 px-2.5 py-0.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            {step.action === "explore" ? "Explore" : "Confirm"}
          </span>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Experiment {step.step}</h3>
        </div>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${passFailBadgeClass(step.resultPass)}`}>{step.resultPass ? "PASS" : "FAIL"}</span>
      </div>

      {step.changedFromBaselineLabels.length > 0 && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
          At candidate value: <span className="font-medium text-zinc-700 dark:text-zinc-300">{step.changedFromBaselineLabels.join(", ")}</span>
        </p>
      )}

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">Why this experiment?</p>
        <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{step.whySelected}</p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">Eliminated</p>
          <HypothesisPills hypotheses={step.hypothesesEliminated} tone="rejected" empty="Nothing newly eliminated" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">Remaining</p>
          <HypothesisPills hypotheses={step.hypothesesRemaining} tone="remaining" empty="None" />
        </div>
      </div>

      <TechnicalDetails step={step} />

      <div className="mt-3">
        <RunEvidenceDetails run={step.aggregateAfter.runs[step.aggregateAfter.runs.length - 1]} />
      </div>
    </Card>
  );
}

export function ExperimentTrace({ steps }: { steps: PlannerStepViewModel[] }) {
  if (steps.length === 0) {
    return (
      <Card className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
        No diagnostic experiments were needed beyond baseline/candidate replication — the evidence was already decisive at that point.
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {steps.map((step) => (
        <StepCard key={step.step} step={step} />
      ))}
    </div>
  );
}
