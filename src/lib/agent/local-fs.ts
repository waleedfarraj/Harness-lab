import "server-only";

import fs from "node:fs";
import path from "node:path";
import { BLOCKED_SEGMENTS } from "./workspace-security";

/**
 * Plain local-filesystem helpers. Used by `LocalExperimentRunner` (as its
 * SandboxRunner file operations) AND, separately, by the evaluator to read
 * the canonical fixture — which always lives on local disk under
 * HarnessLab's own control, regardless of which SandboxRunner an experiment
 * uses to execute the agent.
 */

export function listLocalFiles(root: string, relDir = "."): string[] {
  const absRoot = path.resolve(root);
  const startDir = path.resolve(absRoot, relDir);
  const out: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (BLOCKED_SEGMENTS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.push(path.relative(absRoot, full).split(path.sep).join("/"));
      }
    }
  }

  walk(startDir);
  return out.sort();
}

export function readLocalFile(root: string, relPath: string): string {
  return fs.readFileSync(path.resolve(root, relPath), "utf8");
}

export function safeReadLocalFile(root: string, relPath: string): string | null {
  try {
    return readLocalFile(root, relPath);
  } catch {
    return null;
  }
}

export function writeLocalFile(root: string, relPath: string, content: string): void {
  const full = path.resolve(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}
