"use client";

import { useState } from "react";
import type { NemotronTestResponse } from "@/types/nemotron";

const DEFAULT_PROMPT =
  "Explain in two sentences why changing both a coding agent's skill and context policy can cause a regression even when either change works independently.";

export default function Home() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NemotronTestResponse | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/nemotron/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      setResult((await res.json()) as NemotronTestResponse);
    } catch {
      setResult({ success: false, error: { code: "client_error", message: "Could not reach the HarnessLab server" } });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">HarnessLab</h1>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">Find what actually broke your coding agent.</p>

      <label htmlFor="prompt" className="mt-8 block text-sm font-medium">
        Prompt
      </label>
      <textarea
        id="prompt"
        rows={5}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="button"
        onClick={run}
        disabled={loading || prompt.trim() === ""}
        className="mt-3 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {loading ? "Running…" : "Run Nemotron"}
      </button>

      <section aria-live="polite" className="mt-8">
        {result?.success === false && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <p className="font-medium">Error: {result.error.code}</p>
            <p className="mt-1">{result.error.message}</p>
          </div>
        )}

        {result?.success && (
          <div className="rounded-md border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
            <p className="whitespace-pre-wrap text-sm">{result.output}</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-zinc-200 pt-3 text-xs text-zinc-600 sm:grid-cols-3 dark:border-zinc-800 dark:text-zinc-400">
              <Meta label="Model" value={result.model} />
              <Meta label="Latency" value={`${result.latencyMs} ms`} />
              <Meta label="Finish reason" value={result.finishReason ?? "unavailable"} />
              <Meta label="Input tokens" value={fmt(result.usage?.inputTokens)} />
              <Meta label="Output tokens" value={fmt(result.usage?.outputTokens)} />
              <Meta label="Total tokens" value={fmt(result.usage?.totalTokens)} />
            </dl>
          </div>
        )}
      </section>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium">{label}</dt>
      <dd className="truncate" title={value}>{value}</dd>
    </div>
  );
}

function fmt(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString() : "unavailable";
}
