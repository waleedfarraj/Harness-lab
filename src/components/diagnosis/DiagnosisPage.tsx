import type { AggregateViewModel } from "@/lib/view-model/types";
import type { LoadedDiagnosisDemo } from "@/lib/demo/load-diagnosis";
import { Header } from "./Header";
import { NarrativeFlow } from "./NarrativeFlow";
import { BaselineCandidateCards } from "./BaselineCandidateCards";
import { HarnessDiff } from "./HarnessDiff";
import { SearchSpace } from "./SearchSpace";
import { ExperimentTrace } from "./ExperimentTrace";
import { DiagnosisResult } from "./DiagnosisResult";
import { StabilityPanel } from "./StabilityPanel";
import { MechanismExplanation } from "./MechanismExplanation";
import { SandboxPanel } from "./SandboxPanel";
import { Section } from "./primitives";

/** Every configuration's latest snapshot: baseline, candidate, then each step's aggregateAfter, deduped by bits (later step wins — it has more runs). */
function collectAggregates(vm: LoadedDiagnosisDemo["vm"]): AggregateViewModel[] {
  const byBits = new Map<string, AggregateViewModel>();
  byBits.set(vm.baseline.aggregate.bits, vm.baseline.aggregate);
  byBits.set(vm.candidate.aggregate.bits, vm.candidate.aggregate);
  for (const step of vm.steps) byBits.set(step.aggregateAfter.bits, step.aggregateAfter);
  return [...byBits.values()];
}

export function DiagnosisPage({ vm, activeKey, catalog }: LoadedDiagnosisDemo) {
  const aggregates = collectAggregates(vm);

  return (
    <main>
      <Header vm={vm} catalog={catalog} activeKey={activeKey} />

      <Section eyebrow="Overview" title="What HarnessLab found">
        <NarrativeFlow vm={vm} />
      </Section>

      <Section eyebrow="Controlled experiment" title="Baseline vs. Candidate" subtitle="Same task, same fixture, same evaluator — only the harness configuration differs.">
        <BaselineCandidateCards vm={vm} />
      </Section>

      <Section eyebrow="What changed" title="Harness diff" subtitle={`${vm.dimensionChanges.length} dimension${vm.dimensionChanges.length === 1 ? "" : "s"} changed between baseline and candidate.`}>
        <HarnessDiff changes={vm.dimensionChanges} />
      </Section>

      <Section
        eyebrow="Search space"
        title="Configurations considered"
        subtitle="Every possible combination of the changed dimensions, and which ones HarnessLab actually ran."
      >
        <SearchSpace vm={vm} />
      </Section>

      <Section eyebrow="How it decided" title="Diagnosis trace" subtitle="Each experiment HarnessLab chose to run, why it chose it, and what it eliminated.">
        <ExperimentTrace steps={vm.steps} />
      </Section>

      <Section eyebrow="Conclusion" title="Diagnosis">
        <DiagnosisResult diagnosis={vm.diagnosis} />
      </Section>

      <Section eyebrow="Replicated evidence" title="Stability" subtitle="HarnessLab evaluates a stochastic system — every configuration below was checked against repeated runs, not a single sample.">
        <StabilityPanel aggregates={aggregates} stability={vm.stability} schemaSource={vm.schemaSource} />
      </Section>

      <Section eyebrow="Nemotron" title="What happened?">
        <MechanismExplanation explanation={vm.mechanismExplanation} fixedMechanisms={vm.fixedMechanismsObserved} />
      </Section>

      <Section eyebrow="Infrastructure" title="Sandbox evidence">
        <SandboxPanel vm={vm} />
      </Section>

      <footer className="mx-auto max-w-6xl px-6 pb-12 pt-4 text-xs text-zinc-400 dark:text-zinc-600">
        Diagnosis {vm.diagnosisId} · {vm.schemaSource === "legacy" ? "Milestone 6 evidence schema" : "replicated-evidence schema"}
      </footer>
    </main>
  );
}
