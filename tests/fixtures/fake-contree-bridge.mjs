#!/usr/bin/env node
// Fake Contree bridge for offline TokenFactorySandboxRunner tests. Speaks the
// same one-JSON-request-in, one-JSON-response-out protocol as
// scripts/contree-bridge.py, so TokenFactorySandboxRunner never has to know
// it isn't talking to the real thing. Behavior is selected by FAKE_BRIDGE_MODE.
import { readFileSync } from "node:fs";

const mode = process.env.FAKE_BRIDGE_MODE || "ok";

function respond(obj) {
  process.stdout.write(JSON.stringify(obj));
}

if (mode === "hang") {
  setInterval(() => {}, 1000); // never respond; the runner's own timeout must catch this
} else if (mode === "invalid-json") {
  process.stdout.write("not valid json{{{");
} else if (mode === "fail") {
  respond({ ok: false, error: "simulated bridge failure" });
} else {
  const request = JSON.parse(readFileSync(0, "utf8"));
  if (mode === "echo-env") {
    // Packs what this process can see into `stdout`, which TokenFactorySandboxRunner.execute()
    // passes straight through -- lets a test inspect both the bridge's OWN process env
    // (control-plane; should have the credentials) and the request's `env` field (what would
    // reach code running inside the sandbox; must never have them).
    respond({
      ok: true,
      checkpoint: "chk-echo",
      stdout: JSON.stringify({
        bridgeProcessHasApiKey: Boolean(process.env.NEBIUS_API_KEY),
        bridgeProcessHasProjectId: Boolean(process.env.NEBIUS_PROJECT_ID),
        requestEnvKeys: Object.keys(request.env || {}),
      }),
      stderr: "",
      exitCode: 0,
    });
  } else if (mode === "echo-files" && request.op === "create") {
    // Packs the file paths HarnessLab sent for the initial workspace into `checkpoint`
    // (create() surfaces it, unlike stdout) -- lets a test assert hidden/ was never included.
    respond({ ok: true, checkpoint: JSON.stringify(Object.keys(request.files || {})) });
  } else if (request.op === "create") {
    respond({ ok: true, checkpoint: "chk-created" });
  } else if (request.op === "execute") {
    respond({ ok: true, checkpoint: "chk-after-exec", stdout: "hello\n", stderr: "", exitCode: 0 });
  } else if (request.op === "read_file") {
    respond({ ok: true, content: "fake file content" });
  } else if (request.op === "write_file") {
    respond({ ok: true, checkpoint: "chk-after-write" });
  } else if (request.op === "list_files") {
    respond({ ok: true, files: ["src/a.ts", "tests/a.test.ts"] });
  } else if (request.op === "destroy") {
    respond({ ok: true });
  } else {
    respond({ ok: false, error: `unknown op: ${request.op}` });
  }
}
