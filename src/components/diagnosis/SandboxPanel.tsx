import type { DiagnosisViewModel } from "@/lib/view-model/types";
import { Card, Stat } from "./primitives";

export function SandboxPanel({ vm }: { vm: DiagnosisViewModel }) {
  const s = vm.sandbox;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          {s.runnerKind === "token-factory" ? "Nebius Token Factory Sandbox" : "Local sandbox (dev/offline runner)"}
        </span>
        {s.nemotronUsed && (
          <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
            NVIDIA Nemotron
          </span>
        )}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Shared base checkpoint" value={s.sharedBaseCheckpointTruncated ?? "unavailable"} />
        <Stat label="Base image" value={s.baseImage ?? "unavailable"} />
        <Stat label="Isolated experiments" value={vm.configurationsVisited} hint="forked from the shared checkpoint" />
        <Stat label="Total coding-agent runs" value={s.totalCodingRuns} />
      </dl>

      {(s.exploratoryRunCount !== null || s.confirmationRunCount !== null) && (
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-4 dark:border-zinc-800">
          {s.exploratoryRunCount !== null && <Stat label="Exploratory runs" value={s.exploratoryRunCount} />}
          {s.confirmationRunCount !== null && <Stat label="Confirmation runs" value={s.confirmationRunCount} />}
          {s.environmentPreparationMs !== null && <Stat label="Shared setup time" value={`${(s.environmentPreparationMs / 1000).toFixed(1)}s`} />}
        </dl>
      )}

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
        Every experiment forks from the same prepared checkpoint — hidden evaluator tests (build, public and hidden test suites) run inside the isolated fork, never against the shared base.
      </p>
    </Card>
  );
}
