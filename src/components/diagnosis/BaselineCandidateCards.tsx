import type { DiagnosisViewModel, HarnessSummaryViewModel } from "@/lib/view-model/types";
import { Card, Disclosure } from "./primitives";
import { STATUS_BADGE_CLASS } from "./status";

function HarnessRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-500">{label}</dt>
      <dd className="truncate text-right text-sm text-zinc-800 dark:text-zinc-200" title={value}>
        {value}
      </dd>
    </div>
  );
}

function HarnessCard({ title, result, harness, changed }: { title: string; result: "PASS" | "FAIL"; harness: HarnessSummaryViewModel | null; changed: Set<string> }) {
  return (
    <Card className="flex-1 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${result === "PASS" ? STATUS_BADGE_CLASS.pass : STATUS_BADGE_CLASS.fail}`}>{result}</span>
      </div>
      {harness ? (
        <dl className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
          <HarnessRow label="Skill" value={harness.skillLabel} />
          <HarnessRow label="Context Policy" value={harness.contextPolicy} />
          <HarnessRow label="System Prompt" value={harness.systemPromptShort} />
          <HarnessRow label="Max Turns" value={String(harness.maxTurns)} />
        </dl>
      ) : (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-500">Harness configuration unavailable for this evidence file.</p>
      )}
      {harness?.skillContent && (
        <Disclosure summary="Full skill content" className="mt-4">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">{harness.skillContent}</pre>
        </Disclosure>
      )}
      {harness && (
        <Disclosure summary="Full system prompt" className="mt-2">
          <p className="max-h-48 overflow-auto rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">{harness.systemPromptFull}</p>
        </Disclosure>
      )}
      {changed.size > 0 && (
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
          Changed vs. the other arm: <span className="font-medium text-zinc-700 dark:text-zinc-300">{[...changed].join(", ")}</span>
        </p>
      )}
    </Card>
  );
}

export function BaselineCandidateCards({ vm }: { vm: DiagnosisViewModel }) {
  const changedLabels = new Set(vm.dimensionChanges.map((d) => d.label));
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <HarnessCard title="Baseline" result={vm.baseline.result} harness={vm.baseline.harness} changed={changedLabels} />
      <HarnessCard title="Candidate" result={vm.candidate.result} harness={vm.candidate.harness} changed={changedLabels} />
    </div>
  );
}
