// Replays SAVED evidence in the judge-facing UI. No Nebius calls, no API key needed.
//   npm run demo:replay                    summary + start the UI at http://localhost:4000/?evidence=applypilot
//   npm run demo:replay -- --summary-only  print the summary and exit
//   npm run demo:replay -- --evidence=<key>  replay another catalog entry (default: applypilot)
//   npm run demo:replay -- --port=4001
// Live experiments are separate: npm run diagnose:applypilot (needs .env.local + Token Factory access).
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadDiagnosisForDemo } from "../src/lib/demo/load-diagnosis";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const key = arg("evidence") ?? "applypilot";
const port = Number(arg("port") ?? 4000);
const summaryOnly = process.argv.includes("--summary-only");

function portInUse(p: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port: p, host: "127.0.0.1" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

function printSummary() {
  const loaded = loadDiagnosisForDemo(key);
  const { vm, findings, framing, claimAudit, sourceFilePath } = loaded;
  const rel = path.relative(process.cwd(), sourceFilePath);
  const line = "─".repeat(72);

  console.log(`\nHarnessLab — replay of saved evidence (no API calls)\n${line}`);
  if (framing) console.log(`${framing.badge.toUpperCase()}\n  not a live production integration; ApplyPilot is not touched.\n${line}`);
  console.log(`Task        ${vm.taskTitle}`);
  console.log(`Model       ${vm.model ?? "unavailable"}`);
  const outcome = (a: typeof vm.baseline.aggregate, result: string) => `${result === "PASS" ? a.passCount : a.failCount}/${a.passCount + a.failCount} ${result}`;
  console.log(`Baseline    ${outcome(vm.baseline.aggregate, vm.baseline.result)}`);
  console.log(`Candidate   ${outcome(vm.candidate.aggregate, vm.candidate.result)}`);
  console.log(`Changed     ${vm.dimensionChanges.length} dimensions: ${vm.dimensionChanges.map((d) => d.label).join(" + ")}`);
  const dx = vm.diagnosis;
  console.log(`Diagnosis   ${dx.type === "inconclusive" ? `inconclusive — ${dx.reason}` : `${dx.type === "main_effect" ? "main effect" : "interaction"}: ${dx.factorLabels.join(" × ")}`}`);
  console.log(`Evidence    ${vm.stability?.evidenceQuality.toUpperCase() ?? "n/a"} (${vm.sandbox.totalCodingRuns} recorded coding-agent runs)`);
  console.log(`Source      ${rel}`);

  const provenanceFile = path.join(path.dirname(sourceFilePath), "provenance.json");
  if (fs.existsSync(provenanceFile)) {
    const p = JSON.parse(fs.readFileSync(provenanceFile, "utf8")) as { sha256: string };
    const actual = crypto.createHash("sha256").update(fs.readFileSync(sourceFilePath)).digest("hex");
    console.log(`Integrity   ${actual === p.sha256 ? "OK — matches recorded sha256" : "MISMATCH — file differs from the frozen copy"}`);
  }

  if (findings) {
    console.log(`${line}\nOBSERVED (computed from recorded traces)`);
    for (const g of [findings.baseline, findings.candidate, ...findings.isolating]) {
      console.log(`  ${g.label.padEnd(36)} ${g.passCount}/${g.runCount} pass | compaction ${g.runsWithCompaction}/${g.runCount} | "unchanged" marker ${g.runsWithMarkerReads}/${g.runCount} | tests run ${g.runsThatRanTests}/${g.runCount}`);
    }
    console.log(`  failing runs that lost a file after compaction: ${findings.failingRunsWithLostFile}/${findings.failingRuns}`);
  }
  if (claimAudit) {
    console.log(`${line}\nNEMOTRON'S EXPLANATION, CHECKED AGAINST THE TRACES`);
    for (const c of claimAudit.claims) console.log(`  [${c.verdict.replace(/_/g, " ")}] ${c.claim}`);
    console.log("LIMITATIONS");
    for (const l of claimAudit.limitations) console.log(`  - ${l}`);
  } else if (framing) {
    console.log(`${line}\n(no claim audit matches this exact diagnosis, so none is shown)`);
  }
  console.log(line);
}

async function main() {
  printSummary();
  if (summaryOnly) return;

  const url = `http://localhost:${port}/?evidence=${key}`;
  if (await portInUse(port)) {
    console.log(`\nPort ${port} is already serving. If that is HarnessLab, open:\n  ${url}\n(Pick another port with --port=4001 to start a separate replay server.)`);
    return;
  }

  console.log(`\nStarting the replay UI. Open:\n  ${url}\n(Ctrl+C to stop. The server runs with NEBIUS_API_KEY blanked; this page never calls the API.)\n`);
  const next = path.join(process.cwd(), "node_modules", ".bin", "next");
  const child = spawn(next, ["dev", "-p", String(port)], {
    stdio: "inherit",
    env: { ...process.env, NEBIUS_API_KEY: "", HARNESSLAB_REPLAY: "1", HARNESSLAB_DEMO_DIAGNOSIS: key },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
}

main().catch((err) => {
  console.error("Replay failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
