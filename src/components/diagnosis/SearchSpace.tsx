import type { CellStatus, DiagnosisViewModel } from "@/lib/view-model/types";
import { Card, Stat } from "./primitives";
import { STATUS_CELL_CLASS, STATUS_LABEL } from "./status";

const LEGEND_ORDER: CellStatus[] = ["baseline", "candidate", "pass", "fail", "unstable", "not_tested"];

export function SearchSpace({ vm }: { vm: DiagnosisViewModel }) {
  const n = vm.dimensionChanges.length;
  const presentStatuses = new Set(vm.configurationGrid.map((c) => c.status));

  return (
    <Card className="p-5 sm:p-6">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Dimensions changed" value={n} />
        <Stat label="Possible configurations" value={vm.exhaustiveConfigurations} hint={`2^${n}`} />
        <Stat label="HarnessLab executed" value={vm.configurationsVisited} />
        <Stat label="Avoided" value={vm.configurationsAvoided} hint={`${vm.searchSpaceReductionPct}% search-space reduction`} />
      </dl>

      <div className="mt-6 flex flex-wrap gap-2" role="img" aria-label={`Grid of ${vm.exhaustiveConfigurations} harness configurations, ${vm.configurationsVisited} tested`}>
        {vm.configurationGrid.map((cell) => (
          <div
            key={cell.bits}
            title={`${cell.bits} — ${STATUS_LABEL[cell.status]}${cell.stepIndex !== null ? ` (experiment ${cell.stepIndex + 1})` : ""}`}
            className={`flex h-12 w-12 flex-col items-center justify-center rounded-md text-[10px] font-mono font-medium text-white/90 ${STATUS_CELL_CLASS[cell.status]} ${
              cell.status === "not_tested" ? "text-zinc-400 dark:text-zinc-600" : ""
            } ${cell.stepIndex !== null ? "ring-2 ring-zinc-900/50 ring-offset-1 ring-offset-white dark:ring-white/50 dark:ring-offset-zinc-900" : ""}`}
          >
            {cell.bits}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        {LEGEND_ORDER.filter((s) => presentStatuses.has(s)).map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <span className={`h-2.5 w-2.5 rounded-sm ${STATUS_CELL_CLASS[status]}`} />
            {STATUS_LABEL[status]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="h-2.5 w-2.5 rounded-sm ring-2 ring-zinc-900/50 dark:ring-white/50" />
          Selected by planner
        </span>
      </div>
    </Card>
  );
}
