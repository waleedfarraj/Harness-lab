import type { DiagnosisOutcomeViewModel } from "@/lib/view-model/types";
import { Card } from "./primitives";
import { HypothesisPills } from "./HypothesisPills";

function OutcomeIcon({ ok }: { ok: boolean }) {
  return (
    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${ok ? "bg-emerald-100 dark:bg-emerald-500/15" : "bg-amber-100 dark:bg-amber-500/15"}`}>
      {ok ? (
        <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 20 20" fill="none">
          <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg className="h-5 w-5 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="none">
          <path d="M10 6v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10" cy="14" r="1" fill="currentColor" />
        </svg>
      )}
    </div>
  );
}

export function DiagnosisResult({ diagnosis }: { diagnosis: DiagnosisOutcomeViewModel }) {
  if (diagnosis.type === "inconclusive") {
    return (
      <Card className="p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <OutcomeIcon ok={false} />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">Evidence insufficient for a unique diagnosis</p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{diagnosis.reason}</p>
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">Remaining explanations</p>
            <HypothesisPills hypotheses={diagnosis.remainingHypotheses} tone="remaining" />
          </div>
        </div>
      </Card>
    );
  }

  const isInteraction = diagnosis.type === "interaction";
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <OutcomeIcon ok />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">{isInteraction ? "Interaction detected" : "Primary regression factor"}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{diagnosis.headline}</p>
          {isInteraction && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Neither factor alone reproduces the failure — only the combination does.</p>}
        </div>
      </div>
    </Card>
  );
}
