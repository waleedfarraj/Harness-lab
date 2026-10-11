import type { ClaimAudit } from "@/lib/demo/load-diagnosis";
import type { DemoFraming } from "@/lib/demo/evidence-catalog";
import type { GroupFinding, RunFinding, StepKind, TraceFindings } from "@/lib/demo/trace-findings";
import type { DiagnosisViewModel } from "@/lib/view-model/types";
import { Card, Disclosure } from "./primitives";

/** Scope disclosure. Rendered only for evidence derived from another project. */
export function FramingBanner({ framing }: { framing: DemoFraming }) {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-6" aria-label="Scope of this demonstration">
      <Card className="border-amber-300 bg-amber-50/60 p-5 dark:border-amber-900/60 dark:bg-amber-500/5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">{framing.badge}</span>
          <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">Replay of saved evidence · no live API calls</span>
        </div>
        <h2 className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">{framing.title}</h2>
        <div className="mt-3 grid gap-6 text-sm text-zinc-700 sm:grid-cols-2 dark:text-zinc-300">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">What this is</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">{framing.is.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">What this is not</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">{framing.isNot.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
        </div>
      </Card>
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pass" | "fail" | "neutral" }) {
  const toneClass = tone === "pass" ? "text-emerald-700 dark:text-emerald-300" : tone === "fail" ? "text-rose-700 dark:text-rose-300" : "text-zinc-900 dark:text-zinc-50";
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </Card>
  );
}

/** The headline numbers, straight from the diagnosis (not recomputed): pass counts, changed dimensions, attribution, evidence quality. */
export function ResultAtAGlance({ vm }: { vm: DiagnosisViewModel }) {
  const b = vm.baseline.aggregate;
  const c = vm.candidate.aggregate;
  // "2/2 FAIL" = 2 of 2 runs matched the outcome shown, so a failing candidate reads as failures-over-runs, not passes-over-runs.
  const outcomeCount = (a: typeof b, result: string) => `${result === "PASS" ? a.passCount : a.failCount}/${a.passCount + a.failCount} ${result}`;
  const attribution = vm.diagnosis.type === "inconclusive" ? "Inconclusive" : vm.diagnosis.factorLabels.join(" × ");
  const kind = vm.diagnosis.type === "main_effect" ? "main effect" : vm.diagnosis.type === "interaction" ? "interaction" : "no unique cause";
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Tile label="Baseline" value={outcomeCount(b, vm.baseline.result)} sub="build, public and hidden tests" tone={vm.baseline.result === "PASS" ? "pass" : "fail"} />
      <Tile label="Candidate" value={outcomeCount(c, vm.candidate.result)} sub="same task, same evaluator" tone={vm.candidate.result === "PASS" ? "pass" : "fail"} />
      <Tile label="Harness dimensions changed" value={String(vm.dimensionChanges.length)} sub={vm.dimensionChanges.map((d) => d.label).join(" + ")} />
      <Tile label="Root-cause attribution" value={attribution} sub={kind} />
      <Tile label="Evidence quality" value={(vm.stability?.evidenceQuality ?? "n/a").toUpperCase()} sub={`${vm.sandbox.totalCodingRuns} sandboxed coding-agent runs`} />
    </div>
  );
}

const KIND_STYLE: Record<StepKind, { glyph: string; cls: string; label: string }> = {
  list: { glyph: "ls", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", label: "list" },
  read: { glyph: "read", cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200", label: "read file" },
  read_marker: { glyph: "read→“unchanged”", cls: "bg-rose-100 text-rose-800 ring-1 ring-rose-300 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-800", label: "re-read returned the 'unchanged' marker, not content" },
  write: { glyph: "write", cls: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200", label: "write file" },
  test: { glyph: "npm test", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200", label: "ran tests" },
  build: { glyph: "build", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200", label: "ran build" },
  other: { glyph: "other", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", label: "other" },
  final: { glyph: "done", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", label: "final answer" },
};

const base = (p: string | null) => (p ? p.split("/").pop() : "");

function Timeline({ run, title }: { run: RunFinding; title: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {title} <span className="font-mono text-zinc-400">{run.runId.slice(0, 8)}</span>
        </p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${run.success ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200"}`}>
          {run.success ? "PASS" : "FAIL"} · {run.terminationReason}
        </span>
      </div>
      <ol className="mt-2 flex flex-wrap gap-1.5">
        {run.steps.map((s, i) => {
          const style = KIND_STYLE[s.kind];
          return (
            <li key={i} className="flex flex-col items-start gap-1">
              <span className={`rounded-md px-1.5 py-1 font-mono text-[11px] leading-none ${style.cls}`} title={`turn ${s.turn}: ${style.label}${s.target ? ` — ${s.target}` : ""}`}>
                <span className="opacity-60">t{s.turn}</span> {style.glyph}
                {s.target && s.kind !== "test" && s.kind !== "build" ? <span className="opacity-70"> {base(s.target)}</span> : null}
              </span>
              {s.compactedNow.length > 0 && (
                <span className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] leading-none text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" title="Earlier tool result(s) replaced by a placeholder before this turn's request">
                  compacted: {s.compactedNow.map(base).join(", ")}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function groupLine(g: GroupFinding) {
  return `${g.passCount}/${g.runCount} passed · compaction in ${g.runsWithCompaction}/${g.runCount} · “unchanged” marker in ${g.runsWithMarkerReads}/${g.runCount} · ran tests in ${g.runsThatRanTests}/${g.runCount} · wrote code in ${g.runsThatWrote}/${g.runCount}`;
}

const VERDICT: Record<string, { text: string; cls: string }> = {
  observed: { text: "Observed", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" },
  observed_with_caveat: { text: "Observed, with caveat", cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200" },
  inferred: { text: "Inferred", cls: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
};

/** The specific behavioral difference, computed from recorded trajectories, plus a claim-by-claim audit of the model's explanation. */
export function BehavioralDifference({ findings, audit }: { findings: TraceFindings; audit: ClaimAudit | null }) {
  const exemplar = findings.candidate.runs.find((r) => r.compactions.some((c) => c.compactedChars < c.originalChars && r.pathsLost.includes(c.identifier)));
  const lostEvent = exemplar?.compactions.find((c) => exemplar.pathsLost.includes(c.identifier));
  const failing = [findings.baseline, findings.candidate, ...findings.isolating].flatMap((g) => g.runs).filter((r) => !r.success);
  const allFailuresTurnLimitNoTests = failing.length > 0 && failing.every((r) => r.terminationReason === "max_turns" && r.testedAtTurn === null && r.builtAtTurn === null);
  const groups: { title: string; group: GroupFinding }[] = [
    { title: "Baseline (full context)", group: findings.baseline },
    { title: "Candidate (compact context)", group: findings.candidate },
    ...findings.isolating.map((g) => ({ title: `Isolating run: ${g.label.replace(/,/g, ", ").replace(/=/g, " = ")}`, group: g })),
  ];

  return (
    <div className="space-y-6">
      <Card className="border-emerald-200 bg-emerald-50/40 p-5 dark:border-emerald-900/50 dark:bg-emerald-500/5">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Observed in the recorded traces</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-zinc-800 dark:text-zinc-200">
          <li>
            <strong>Baseline:</strong> {findings.baseline.runsThatWrote}/{findings.baseline.runCount} runs wrote code, {findings.baseline.runsThatRanTests}/{findings.baseline.runCount} ran <code>npm test</code>; compaction occurred in {findings.baseline.runsWithCompaction}/{findings.baseline.runCount} runs and the “unchanged” marker in {findings.baseline.runsWithMarkerReads}/{findings.baseline.runCount}.
          </li>
          {lostEvent && exemplar && (
            <li>
              <strong>Candidate</strong> (run <span className="font-mono">{exemplar.runId.slice(0, 8)}</span>)<strong>:</strong> at turn {lostEvent.turn} the harness replaced the contract file <code>{lostEvent.identifier}</code> ({lostEvent.originalChars.toLocaleString()} chars) with a {lostEvent.compactedChars}-char placeholder. The agent then re-read it
              {" "}{exemplar.markerReads.filter((m) => m.path === lostEvent.identifier).length}×, and each time the tool answered “unchanged since your last read … identical to what you already have” instead of returning the text.
            </li>
          )}
          <li>
            <strong>Outcome:</strong> {findings.failingRunsWithLostFile} of {findings.failingRuns} failing runs lost a file this way
            {allFailuresTurnLimitNoTests ? "; every failing run ended at the turn limit without running the tests or the build." : "."}
          </li>
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map(({ title, group }) => (
          <Card key={title} className="p-4">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{groupLine(group)}</p>
            <div className="mt-3 space-y-3">
              {group.runs.map((r, i) => <Timeline key={r.runId} run={r} title={`Run ${i + 1}`} />)}
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-zinc-500">Each chip is one agent turn. Amber chips mark the turn where the compact policy replaced an earlier tool result with a placeholder; red chips are re-reads answered with the “unchanged” marker.</p>

      {audit && (
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Observed vs. inferred</p>
          <h3 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">Checking Nemotron’s explanation against the traces</h3>
          <p className="mt-1 max-w-3xl text-xs text-zinc-500">{audit.basis}</p>
          <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
            {audit.claims.map((c) => (
              <li key={c.claim} className="grid gap-2 py-3 sm:grid-cols-[10rem_1fr]">
                <span className={`h-fit w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ${VERDICT[c.verdict].cls}`}>{VERDICT[c.verdict].text}</span>
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{c.claim}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{c.evidence}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <Disclosure summary={`Limitations (${audit.limitations.length})`}>
              <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-400">{audit.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
            </Disclosure>
          </div>
        </Card>
      )}
    </div>
  );
}
