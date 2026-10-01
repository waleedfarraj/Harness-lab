import type { DiagnosisViewModel } from "@/lib/view-model/types";
import { STATUS_BADGE_CLASS } from "./status";

function Arrow() {
  return (
    <div className="flex shrink-0 items-center justify-center px-0.5 text-zinc-300 dark:text-zinc-700" aria-hidden="true">
      <svg width="18" height="14" viewBox="0 0 28 16">
        <path d="M0 8h24M18 2l6 6-6 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function Node({ title, subtitle, badge, badgeClass, emphasis = false }: { title: string; subtitle?: string; badge?: string; badgeClass?: string; emphasis?: boolean }) {
  return (
    <div
      className={`flex w-[8.5rem] shrink-0 flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-center ${
        emphasis ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      <p className={`text-xs font-medium sm:text-sm ${emphasis ? "" : "text-zinc-800 dark:text-zinc-200"}`}>{title}</p>
      {subtitle && <p className={`text-[11px] leading-snug ${emphasis ? "opacity-80" : "text-zinc-500 dark:text-zinc-500"}`}>{subtitle}</p>}
      {badge && <span className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass ?? ""}`}>{badge}</span>}
    </div>
  );
}

function diagnosisNodeProps(vm: DiagnosisViewModel): { title: string; subtitle?: string } {
  if (vm.diagnosis.type === "inconclusive") return { title: "Diagnosis", subtitle: "Inconclusive — honestly reported" };
  return { title: "Diagnosis", subtitle: vm.diagnosis.headline };
}

export function NarrativeFlow({ vm }: { vm: DiagnosisViewModel }) {
  const n = vm.dimensionChanges.length;
  const diagnosisNode = diagnosisNodeProps(vm);

  return (
    <div className="flex items-center justify-start overflow-x-auto py-1 sm:justify-center">
      <Node title="Baseline Agent" badge={vm.baseline.result} badgeClass={STATUS_BADGE_CLASS.pass} />
      <Arrow />
      <Node title="Harness changed" subtitle={`${n} dimension${n === 1 ? "" : "s"}`} />
      <Arrow />
      <Node title="Candidate Agent" badge={vm.candidate.result} badgeClass={vm.candidate.result === "FAIL" ? STATUS_BADGE_CLASS.fail : STATUS_BADGE_CLASS.pass} />
      <Arrow />
      <Node title={`${vm.exhaustiveConfigurations} possible configurations`} subtitle={`2^${n} combinations`} />
      <Arrow />
      <Node title="HarnessLab selected" subtitle={`${vm.configurationsVisited} of ${vm.exhaustiveConfigurations} — ${vm.searchSpaceReductionPct}% avoided`} />
      <Arrow />
      <Node title={diagnosisNode.title} subtitle={diagnosisNode.subtitle} emphasis />
    </div>
  );
}
