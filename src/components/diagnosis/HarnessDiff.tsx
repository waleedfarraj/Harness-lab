import type { DimensionChangeViewModel } from "@/lib/view-model/types";
import { Card, Disclosure } from "./primitives";

function DiffRow({ change }: { change: DimensionChangeViewModel }) {
  const hasDetail = Boolean(change.baselineDetail || change.candidateDetail);
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{change.label}</p>
      <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <span className="truncate rounded-md bg-rose-50 px-2.5 py-1 font-mono text-xs text-rose-700 sm:max-w-xs dark:bg-rose-500/10 dark:text-rose-300" title={change.baselineValue}>
          {change.baselineValue}
        </span>
        <span className="text-zinc-400 dark:text-zinc-600" aria-hidden="true">
          →
        </span>
        <span className="truncate rounded-md bg-emerald-50 px-2.5 py-1 font-mono text-xs text-emerald-700 sm:max-w-xs dark:bg-emerald-500/10 dark:text-emerald-300" title={change.candidateValue}>
          {change.candidateValue}
        </span>
      </div>
      {hasDetail && (
        <Disclosure summary="Show full values" className="mt-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-zinc-500">Baseline</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-2.5 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                {change.baselineDetail ?? change.baselineValue}
              </pre>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-500">Candidate</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-2.5 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                {change.candidateDetail ?? change.candidateValue}
              </pre>
            </div>
          </div>
        </Disclosure>
      )}
    </div>
  );
}

export function HarnessDiff({ changes }: { changes: DimensionChangeViewModel[] }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {changes.map((change) => (
          <DiffRow key={change.dimension} change={change} />
        ))}
      </div>
    </Card>
  );
}
