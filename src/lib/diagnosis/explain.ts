import "server-only";

import { runNemotron, type RunOptions } from "../nebius/client";
import type { ExperimentResult } from "../experiments/types";
import type { DiagnosisResult } from "./types";

const MAX_TURN_LINES = 20;

function summarizeTrajectory(result: ExperimentResult): string[] {
  const lines: string[] = [];
  for (const turn of result.evidence.trajectory.turns) {
    for (const call of turn.toolCalls) {
      lines.push(`  turn ${turn.turn}: ${call.name} -> ${call.resultSummary.slice(0, 120).replace(/\n/g, " ")}`);
    }
    if (turn.request.newCompactionEvents.length > 0) {
      for (const event of turn.request.newCompactionEvents) {
        lines.push(`  turn ${turn.turn}: [context compacted] ${event.toolName} result for ${event.identifier} (${event.originalChars} -> ${event.compactedChars} chars)`);
      }
    }
  }
  return lines.slice(0, MAX_TURN_LINES);
}

/**
 * Builds the explanation prompt. Pure and offline-testable — no network
 * call. Deliberately states the already-decided classification as fixed and
 * asks only for the mechanism, so Nemotron's output is never what sets
 * `diagnosis` (that field is populated before this function is ever
 * called) — structurally, not just by instruction.
 */
export function buildExplanationPrompt(diagnosis: DiagnosisResult): string {
  const lines: string[] = [];

  lines.push("HarnessLab has already determined, via controlled experiments, the cause of a coding-agent regression.");
  lines.push("Do not decide or restate whether this is a main effect or an interaction — that is fixed. Explain the MECHANISM only:");
  lines.push("why the failing configuration(s) actually failed, citing the evidence below.");
  lines.push("");
  lines.push(`Deterministic diagnosis: ${diagnosis.diagnosis.type}${"factors" in diagnosis.diagnosis ? ` (${diagnosis.diagnosis.factors.join(" x ")})` : ""}`);
  lines.push("");
  lines.push("Changed harness dimensions:");
  lines.push(diagnosis.changedDimensions.map((d) => `- ${d}`).join("\n"));
  lines.push("");
  lines.push("Experiment table:");
  for (const e of diagnosis.evidence) {
    lines.push(`- ${e.label}: ${e.success ? "PASS" : "FAIL"}`);
  }
  lines.push("");
  if (diagnosis.fixedMechanismsObserved.length > 0) {
    lines.push("Fixed mechanisms observed in the failing trajectory (unchanged between baseline and candidate, but part of how the failure manifested):");
    for (const m of diagnosis.fixedMechanismsObserved) lines.push(`- ${m}`);
    lines.push("");
  }

  const failing = [diagnosis.candidateResult, ...diagnosis.experiments.map((e) => e.result)].find((r) => !r.success);
  if (failing) {
    lines.push(`Failing run's termination reason: ${failing.terminationReason}`);
    lines.push(`Failing run's changed files: ${failing.changedFiles.length > 0 ? failing.changedFiles.join(", ") : "(none)"}`);
    lines.push("Failing run's trajectory (tool calls and context events):");
    lines.push(...summarizeTrajectory(failing));
  }

  lines.push("");
  lines.push("Reply with a concise (4-6 sentence) evidence-grounded explanation of the mechanism.");

  return lines.join("\n");
}

export type ExplainDiagnosisOptions = RunOptions;

/** One Nemotron call to explain the mechanism. The classification itself was already decided deterministically before this is ever invoked. */
export async function explainDiagnosis(diagnosis: DiagnosisResult, options: ExplainDiagnosisOptions = {}): Promise<string> {
  const prompt = buildExplanationPrompt(diagnosis);
  const result = await runNemotron(prompt, options);
  return result.output;
}
