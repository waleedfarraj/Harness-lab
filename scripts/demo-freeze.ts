// Freezes a recorded diagnosis into demo-evidence/<slug>/ so the demo can be replayed from a fresh clone.
// `.harnesslab/` is git-ignored, so without this the saved experiment would exist only on one machine.
//   npm run demo:freeze -- applypilot
// Makes a byte-for-byte copy (never edits evidence), records its sha256, and refuses to overwrite a
// different existing snapshot. Nothing in .harnesslab/ is modified or deleted. No network, no API key.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findDemoEvidence } from "../src/lib/demo/evidence-catalog";
import { DEMO_EVIDENCE_DIR, locateEvidenceFile } from "../src/lib/demo/locate-evidence";
import { DIAGNOSES_DIR } from "../src/lib/experiments/evidence";
import type { StableDiagnosisResult } from "../src/lib/diagnosis/types";

const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex");

function main() {
  const key = process.argv[2];
  const entry = findDemoEvidence(key);
  if (!entry?.locate || !entry.auditDir) {
    console.error(`Usage: npm run demo:freeze -- <key>   (keys with a locator: ${["applypilot"].join(", ")})`);
    process.exit(1);
  }

  const source = locateEvidenceFile(entry.locate, [DIAGNOSES_DIR]);
  if (!source) {
    console.error(`No saved diagnosis in ${DIAGNOSES_DIR} matches ${JSON.stringify(entry.locate)}. Run the live experiment first (npm run diagnose:applypilot).`);
    process.exit(1);
  }

  const bytes = fs.readFileSync(source);
  const d = JSON.parse(bytes.toString("utf8")) as StableDiagnosisResult;
  if (!d.regressionDetected || d.diagnosis.type === "inconclusive") {
    console.error(`${path.basename(source)} is not a decisive regression (${d.diagnosis.type}); refusing to freeze it as the demo.`);
    process.exit(1);
  }

  const dir = path.join(DEMO_EVIDENCE_DIR, entry.auditDir);
  const target = path.join(dir, "diagnosis.json");
  if (fs.existsSync(target) && sha256(fs.readFileSync(target)) !== sha256(bytes)) {
    console.error(`${path.relative(process.cwd(), target)} already exists with different content; not overwriting. Move it aside to refreeze.`);
    process.exit(1);
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, bytes);
  const provenance = {
    note: "Byte-for-byte copy of a recorded HarnessLab diagnosis. Not edited. Original is kept in .harnesslab/diagnoses/ (git-ignored).",
    diagnosisId: d.diagnosisId,
    sourceFile: path.join(".harnesslab", "diagnoses", path.basename(source)),
    sha256: sha256(bytes),
    bytes: bytes.length,
    frozenAt: new Date().toISOString(),
    taskId: d.taskId,
    changedDimensions: d.changedDimensions,
    diagnosis: d.diagnosis,
    evidenceQuality: d.stability.evidenceQuality,
    totalCodingRuns: d.totalCodingRuns,
    runIds: [...new Set(d.aggregates.flatMap((a) => a.runs.map((r) => r.runId)))],
  };
  fs.writeFileSync(path.join(dir, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);

  console.log(`Frozen ${d.diagnosisId} -> ${path.relative(process.cwd(), target)} (${bytes.length} bytes, sha256 ${provenance.sha256.slice(0, 12)}…)`);
}

main();
