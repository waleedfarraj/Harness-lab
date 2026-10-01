import type { RunEvidenceViewModel } from "@/lib/view-model/types";
import { Disclosure } from "./primitives";
import { passFailBadgeClass } from "./status";

function Flag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"}`}>
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}

function PathList({ label, paths }: { label: string; paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <ul className="mt-1 space-y-0.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {paths.map((p) => (
          <li key={p} className="truncate">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Section 11: per-run inspection — files, commands, termination, tests, build, turns, tool calls, tokens, latency, compaction/dedup. Never renders the raw multi-thousand-token trajectory by default. */
export function RunEvidenceDetails({ run }: { run: RunEvidenceViewModel }) {
  return (
    <Disclosure summary={`Evidence — ${run.runId.slice(0, 8)} (${run.turnCount} turns, ${run.metrics.toolCalls} tool calls)`}>
      <div className="space-y-4 rounded-lg border border-zinc-100 bg-zinc-50/60 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950/40">
        <div className="flex flex-wrap gap-2">
          <Flag label="Build" ok={run.evaluation.buildPassed} />
          <Flag label="Public tests" ok={run.evaluation.publicTestsPassed} />
          <Flag label="Hidden tests" ok={run.evaluation.hiddenTestsPassed} />
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${passFailBadgeClass(run.success)}`}>{run.success ? "PASS" : "FAIL"}</span>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium text-zinc-500">Termination</dt>
            <dd className="text-xs text-zinc-800 dark:text-zinc-200">{run.terminationReason}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-500">Turns</dt>
            <dd className="text-xs text-zinc-800 dark:text-zinc-200">{run.turnCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-500">Tokens (in/out)</dt>
            <dd className="text-xs text-zinc-800 dark:text-zinc-200">
              {run.metrics.inputTokens ?? "—"} / {run.metrics.outputTokens ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-500">Latency</dt>
            <dd className="text-xs text-zinc-800 dark:text-zinc-200">{(run.metrics.latencyMs / 1000).toFixed(1)}s</dd>
          </div>
        </dl>

        {run.terminationDetail && <p className="text-xs text-zinc-600 dark:text-zinc-400">{run.terminationDetail}</p>}

        <div className="grid gap-4 sm:grid-cols-3">
          <PathList label="Files read" paths={run.filesRead} />
          <PathList label="Files written" paths={run.filesWritten} />
          <PathList label="Commands executed" paths={run.commandsExecuted} />
        </div>

        {(run.dedupHitCount > 0 || run.compactionEvents.length > 0) && (
          <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            {run.dedupHitCount > 0 && (
              <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                {run.dedupHitCount} repeated-read dedup marker{run.dedupHitCount === 1 ? "" : "s"}
              </span>
            )}
            {run.compactionEvents.length > 0 && (
              <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                {run.compactionEvents.length} context compaction event{run.compactionEvents.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {run.toolCalls.length > 0 && (
          <Disclosure summary={`Tool calls (${run.toolCalls.length})`}>
            <ol className="max-h-56 space-y-1 overflow-auto font-mono text-xs text-zinc-700 dark:text-zinc-300">
              {run.toolCalls.map((call, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-zinc-400">t{call.turn}</span>
                  <span className={`shrink-0 ${call.ok ? "text-zinc-500" : "text-rose-500"}`}>{call.name}</span>
                  <span className="truncate text-zinc-500 dark:text-zinc-500">{call.summary}</span>
                </li>
              ))}
            </ol>
          </Disclosure>
        )}

        {run.diffPreview && (
          <Disclosure summary="Diff">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-900 p-3 font-mono text-xs text-zinc-100">
              {run.diffPreview}
              {run.diffTruncated ? "\n… [truncated]" : ""}
            </pre>
          </Disclosure>
        )}
      </div>
    </Disclosure>
  );
}
