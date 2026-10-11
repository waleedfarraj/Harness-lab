import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DIAGNOSES_DIR } from "../experiments/evidence";
import type { StableDiagnosisResult } from "../diagnosis/types";

/** Tracked, replayable evidence snapshots (byte-for-byte copies of `.harnesslab/diagnoses/*.json`, which is git-ignored). */
export const DEMO_EVIDENCE_DIR = path.join(process.cwd(), "demo-evidence");

/**
 * Identifies a saved diagnosis by WHAT it measured, not by what its file is
 * called: the task plus the manifest ids of the baseline and candidate runs.
 * Re-running the live experiment writes a new `<uuid>.json`; the demo keeps
 * working because it finds evidence by content.
 */
export interface EvidenceLocator {
  taskId: string;
  baselineManifestId: string;
  candidateManifestId: string;
}

const QUALITY_RANK: Record<string, number> = { high: 3, moderate: 2, low: 1 };

interface Candidate {
  filePath: string;
  dirRank: number;
  mtimeMs: number;
  regressionDetected: boolean;
  decisive: boolean;
  quality: number;
}

const cache = new Map<string, { mtimeMs: number; size: number; candidate: (Candidate & { locator: EvidenceLocator }) | null }>();

function listJson(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
    else if (entry.isDirectory()) out.push(...listJson(full));
  }
  return out;
}

function inspect(filePath: string, dirRank: number): (Candidate & { locator: EvidenceLocator }) | null {
  const stat = fs.statSync(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.candidate ? { ...cached.candidate, dirRank } : null;

  let candidate: (Candidate & { locator: EvidenceLocator }) | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<StableDiagnosisResult>;
    const baselineManifestId = parsed.baselineAggregate?.runs?.[0]?.manifestId;
    const candidateManifestId = parsed.candidateAggregate?.runs?.[0]?.manifestId;
    if (parsed.taskId && baselineManifestId && candidateManifestId && parsed.diagnosis) {
      candidate = {
        filePath,
        dirRank,
        mtimeMs: stat.mtimeMs,
        regressionDetected: parsed.regressionDetected === true,
        decisive: parsed.diagnosis.type !== "inconclusive",
        quality: QUALITY_RANK[parsed.stability?.evidenceQuality ?? ""] ?? 0,
        locator: { taskId: parsed.taskId, baselineManifestId, candidateManifestId },
      };
    }
  } catch {
    candidate = null; // not a diagnosis file (e.g. provenance.json) or unreadable: ignore
  }
  cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, candidate });
  return candidate;
}

/**
 * Best saved diagnosis for a locator. Preference: earlier directory first (the frozen, tracked snapshot beats any newer live run, so replay stays stable), then a detected regression with a
 * decisive diagnosis, then higher evidence quality, then the most recent file.
 * An earlier unstable attempt is therefore never preferred over a clean run, and
 * nothing is deleted or overwritten — losing candidates simply stay on disk.
 */
export function locateEvidenceFile(locator: EvidenceLocator, dirs: string[] = [DEMO_EVIDENCE_DIR, DIAGNOSES_DIR]): string | null {
  const matches: Candidate[] = [];
  for (const [dirRank, dir] of dirs.entries()) {
    for (const file of listJson(dir)) {
      const c = inspect(file, dirRank);
      if (
        c &&
        c.locator.taskId === locator.taskId &&
        c.locator.baselineManifestId === locator.baselineManifestId &&
        c.locator.candidateManifestId === locator.candidateManifestId
      ) {
        matches.push(c);
      }
    }
  }
  if (matches.length === 0) return null;

  matches.sort(
    (a, b) =>
      a.dirRank - b.dirRank ||
      Number(b.regressionDetected) - Number(a.regressionDetected) ||
      Number(b.decisive) - Number(a.decisive) ||
      b.quality - a.quality ||
      b.mtimeMs - a.mtimeMs,
  );
  return matches[0].filePath;
}
