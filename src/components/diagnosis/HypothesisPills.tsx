import type { HypothesisViewModel } from "@/lib/view-model/types";

const TONE_CLASS: Record<"rejected" | "remaining" | "supported", string> = {
  rejected: "bg-rose-50 text-rose-700 line-through decoration-rose-400/60 dark:bg-rose-500/10 dark:text-rose-300",
  remaining: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  supported: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
};

export function HypothesisPills({ hypotheses, tone, empty }: { hypotheses: HypothesisViewModel[]; tone: "rejected" | "remaining" | "supported"; empty?: string }) {
  if (hypotheses.length === 0) {
    return <p className="mt-1.5 text-sm text-zinc-400 dark:text-zinc-600">{empty ?? "None"}</p>;
  }
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {hypotheses.map((h) => (
        <li key={h.id} className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${TONE_CLASS[h.status === "supported" ? "supported" : tone]}`}>
          {h.type === "interaction" && <span className="mr-1 text-[10px] uppercase tracking-wide opacity-60">interaction</span>}
          {h.label}
        </li>
      ))}
    </ul>
  );
}
