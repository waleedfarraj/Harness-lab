import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { ExperimentResult } from "./types";

const RUNS_DIR = path.join(process.cwd(), ".harnesslab", "runs");

/** Local JSON evidence file per run. Never includes the API key or the full process environment. */
export function writeRunEvidence(result: ExperimentResult): string {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const filePath = path.join(RUNS_DIR, `${result.runId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), "utf8");
  return filePath;
}
