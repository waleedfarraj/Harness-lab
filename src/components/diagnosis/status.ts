import type { CellStatus } from "@/lib/view-model/types";

/**
 * The one place diagnosis-state colors are defined. Every component that
 * renders a PASS/FAIL/unstable/etc. badge or grid cell imports from here
 * instead of picking its own Tailwind classes, so the same state always
 * reads the same color across the page.
 */
export const STATUS_LABEL: Record<CellStatus, string> = {
  baseline: "Baseline",
  candidate: "Candidate",
  pass: "Pass",
  fail: "Fail",
  unstable: "Unstable",
  not_tested: "Not tested",
};

export const STATUS_BADGE_CLASS: Record<CellStatus, string> = {
  baseline: "bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/30",
  candidate: "bg-violet-100 text-violet-800 ring-1 ring-inset ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/30",
  pass: "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  fail: "bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/30",
  unstable: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30",
  not_tested: "bg-zinc-100 text-zinc-500 ring-1 ring-inset ring-zinc-500/10 dark:bg-zinc-800/60 dark:text-zinc-500 dark:ring-white/5",
};

export const STATUS_CELL_CLASS: Record<CellStatus, string> = {
  baseline: "bg-sky-500 dark:bg-sky-400",
  candidate: "bg-violet-500 dark:bg-violet-400",
  pass: "bg-emerald-500 dark:bg-emerald-400",
  fail: "bg-rose-500 dark:bg-rose-400",
  unstable: "bg-amber-500 dark:bg-amber-400",
  not_tested: "bg-zinc-200 dark:bg-zinc-800",
};

export function passFailBadgeClass(pass: boolean): string {
  return pass ? STATUS_BADGE_CLASS.pass : STATUS_BADGE_CLASS.fail;
}

export function evidenceQualityClass(quality: "low" | "moderate" | "high"): string {
  if (quality === "high") return STATUS_BADGE_CLASS.pass;
  if (quality === "moderate") return STATUS_BADGE_CLASS.unstable;
  return STATUS_BADGE_CLASS.fail;
}
