import Link from "next/link";
import type { DemoEvidenceEntry } from "@/lib/demo/evidence-catalog";
import type { DiagnosisViewModel } from "@/lib/view-model/types";

export function Header({ vm, catalog, activeKey }: { vm: DiagnosisViewModel; catalog: DemoEvidenceEntry[]; activeKey: string }) {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-6 pt-10">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">HarnessLab</h1>
            <p className="mt-1 text-base text-zinc-600 dark:text-zinc-400">Find what actually broke your coding agent.</p>
          </div>
          <nav aria-label="Evidence examples" className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900">
            {catalog.map((entry) => {
              const isActive = entry.key === activeKey;
              return (
                <Link
                  key={entry.key}
                  href={`/?evidence=${entry.key}`}
                  title={entry.description}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                  }`}
                >
                  {entry.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-zinc-200 py-4 text-sm sm:grid-cols-4 dark:border-zinc-800">
          <MetaItem label="Task" value={vm.taskTitle} />
          <MetaItem label="Model" value={vm.model ?? "unavailable"} mono />
          <MetaItem label="Fixture" value={vm.taskId} mono />
          <MetaItem label="Runner" value="Nebius Token Factory Sandbox" />
        </dl>
      </div>
    </header>
  );
}

function MetaItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-500">{label}</dt>
      <dd className={`mt-0.5 truncate text-zinc-800 dark:text-zinc-200 ${mono ? "font-mono text-xs" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}
