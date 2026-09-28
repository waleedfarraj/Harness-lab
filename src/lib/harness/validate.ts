import "server-only";

import type { HarnessManifest } from "./types";

export class InvalidHarnessManifestError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid HarnessManifest: ${problems.join("; ")}`);
    this.name = "InvalidHarnessManifestError";
    this.problems = problems;
  }
}

/** Structural validation only — this is a config shape check, not a judgment about whether the prompt is "good". */
export function validateHarnessManifest(manifest: HarnessManifest): void {
  const problems: string[] = [];

  if (typeof manifest.id !== "string" || manifest.id.trim() === "") problems.push("id must be a non-empty string");
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") problems.push("name must be a non-empty string");
  if (typeof manifest.model !== "string" || manifest.model.trim() === "") problems.push("model must be a non-empty string");
  if (typeof manifest.systemPrompt !== "string" || manifest.systemPrompt.trim() === "") {
    problems.push("systemPrompt must be a non-empty string");
  }
  if (
    typeof manifest.execution?.maxTurns !== "number" ||
    !Number.isInteger(manifest.execution.maxTurns) ||
    manifest.execution.maxTurns < 1
  ) {
    problems.push("execution.maxTurns must be a positive integer");
  }

  if (problems.length > 0) {
    throw new InvalidHarnessManifestError(problems);
  }
}
