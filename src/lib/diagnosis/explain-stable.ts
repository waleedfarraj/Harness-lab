import "server-only";

import { runNemotron, type RunOptions } from "../nebius/client";
import type { ExperimentResult } from "../experiments/types";
import type { ConfigurationAggregate, StableDiagnosisResult } from "./types";

const MAX_TURN_LINES = 15;
const MAX_TRAJECTORIES = 2;

function summarizeTrajectory(result: ExperimentResult): string[] {
  const lines: string[] = [];
  for (const turn of result.evidence.trajectory.turns) {
    for (const call of turn.toolCalls) {
      lines.push(`    turn ${turn.turn}: ${call.name} -> ${call.resultSummary.slice(0, 120).replace(/\n/g, " ")}`);
    }
    if (turn.request.newCompactionEvents.length > 0) {
      for (const event of turn.request.newCompactionEvents) {
        lines.push(`    turn ${turn.turn}: [context compacted] ${event.toolName} result for ${event.identifier} (${event.originalChars} -> ${event.compactedChars} chars)`);
      }
    }
  }
  return lines.slice(0, MAX_TURN_LINES);
}

function summarizeAggregate(agg: ConfigurationAggregate): string {
  const outcomes = agg.runs.map((r) => (r.success ? "PASS" : "FAIL")).join(", ");
  return `- ${agg.label} (${agg.configurationVector}): ${agg.runs.length} runs [${outcomes}], failure rate ${(agg.failureRate * 100).toFixed(1)}%, stability=${agg.stability}`;
}

/**
 * Builds the explanation prompt. Pure and offline-testable. Deliberately
 * states the already-decided classification (and, when inconclusive, the
 * remaining candidate explanations) as fixed, and sends only aggregate
 * summaries plus a couple of representative trajectories — not every full
 * run — since repeated context is exactly the token cost this project has
 * spent several milestones deterministically avoiding.
 */
export function buildStableExplanationPrompt(diagnosis: StableDiagnosisResult): string {
  const lines: string[] = [];

  lines.push("HarnessLab has already determined, via repeated controlled experiments, the cause (or the ambiguity) of a coding-agent regression.");
  lines.push("Every configuration below was run multiple times — do not treat a single run as proof either way; the classification is already fixed from the full replicated evidence.");
  if (diagnosis.diagnosis.type === "inconclusive") {
    lines.push("This diagnosis is INCONCLUSIVE. Do not pick a winner. Explain WHY the evidence cannot yet distinguish the remaining explanations, citing the unstable configuration(s) below.");
  } else {
    lines.push("Do not decide or restate whether this is a main effect or an interaction — that is fixed. Explain the MECHANISM only, citing the evidence below.");
  }
  lines.push("");
  lines.push(
    `Deterministic diagnosis: ${diagnosis.diagnosis.type}${"factors" in diagnosis.diagnosis ? ` (${diagnosis.diagnosis.factors.join(" x ")})` : ""}`,
  );
  if (diagnosis.diagnosis.type === "inconclusive") lines.push(`Reason given by the deterministic engine: ${diagnosis.diagnosis.reason}`);
  lines.push("");
  lines.push("Changed harness dimensions:");
  lines.push(diagnosis.changedDimensions.map((d) => `- ${d}`).join("\n"));
  lines.push("");
  lines.push(`Evidence quality: ${diagnosis.stability.evidenceQuality} (${diagnosis.stability.reason})`);
  lines.push("");
  lines.push("Configuration aggregates (replicated evidence, most recent classification):");
  lines.push(summarizeAggregate(diagnosis.baselineAggregate));
  lines.push(summarizeAggregate(diagnosis.candidateAggregate));
  for (const step of diagnosis.steps) lines.push(summarizeAggregate(step.aggregateAfter));
  lines.push("");

  if (diagnosis.stability.unstableConfigurations.length > 0) {
    lines.push(`Unstable configurations (inconsistent across their own repeated runs): ${diagnosis.stability.unstableConfigurations.join(", ")}`);
    lines.push("");
  }

  if (diagnosis.fixedMechanismsObserved.length > 0) {
    lines.push("Fixed mechanisms observed in failing runs (unchanged between baseline and candidate, but part of how failures manifested):");
    for (const m of diagnosis.fixedMechanismsObserved) lines.push(`- ${m}`);
    lines.push("");
  }

  // A couple of representative trajectories only — one failing, one from an unstable config if any — never every run.
  const failingRun = diagnosis.candidateAggregate.runs.find((r) => !r.success);
  const unstableAgg = diagnosis.aggregates.find((a) => a.stability === "unstable");
  const representative: { label: string; result: ExperimentResult }[] = [];
  if (failingRun) representative.push({ label: `${diagnosis.candidateAggregate.label} (failing run)`, result: failingRun });
  if (unstableAgg && unstableAgg.runs.length > 0) {
    const differing = unstableAgg.runs.find((r) => r.success !== failingRun?.success) ?? unstableAgg.runs[0];
    representative.push({ label: `${unstableAgg.label} (${unstableAgg.configurationVector}, one of its disagreeing runs)`, result: differing });
  }

  for (const { label, result } of representative.slice(0, MAX_TRAJECTORIES)) {
    lines.push(`Trajectory for ${label} — termination: ${result.terminationReason}, changed files: ${result.changedFiles.length > 0 ? result.changedFiles.join(", ") : "(none)"}`);
    lines.push(...summarizeTrajectory(result));
    lines.push("");
  }

  lines.push(
    diagnosis.diagnosis.type === "inconclusive"
      ? "Reply with a concise (4-6 sentence) explanation of why the evidence remains ambiguous. Do not choose a winner."
      : "Reply with a concise (4-6 sentence) evidence-grounded explanation of the mechanism.",
  );

  return lines.join("\n");
}

export type ExplainStableDiagnosisOptions = RunOptions;

/** One Nemotron call to explain the mechanism (or the ambiguity). The classification itself was already decided deterministically before this is ever invoked. */
export async function explainStableDiagnosis(diagnosis: StableDiagnosisResult, options: ExplainStableDiagnosisOptions = {}): Promise<string> {
  const prompt = buildStableExplanationPrompt(diagnosis);
  const result = await runNemotron(prompt, options);
  return result.output;
}
