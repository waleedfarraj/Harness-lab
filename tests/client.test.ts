import assert from "node:assert/strict";
import { test } from "node:test";
import { NebiusError, runNemotron } from "../src/lib/nebius/client";
import type { NebiusConfig } from "../src/lib/nebius/config";

const SECRET = "sk-test-SECRET-123";
const config: NebiusConfig = {
  apiKey: SECRET,
  baseUrl: "https://example.test/v1",
  model: "nvidia/test-model",
  timeoutMs: 50,
};

const json = (status: number, body: unknown): typeof fetch =>
  async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function expectError(fetchImpl: typeof fetch, code: string): Promise<NebiusError> {
  try {
    await runNemotron("hi", { config, fetchImpl });
  } catch (err) {
    assert.ok(err instanceof NebiusError);
    assert.equal(err.code, code);
    assert.ok(!err.message.includes(SECRET), "error message must not contain the API key");
    return err;
  }
  assert.fail("expected runNemotron to throw");
}

test("sends an OpenAI-compatible request and maps the response", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    captured = { url: String(url), init: init! };
    return json(200, {
      model: "nvidia/test-model",
      choices: [{ message: { content: " Hello " }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })(url, init);
  };

  const result = await runNemotron("hi", { config, fetchImpl });

  assert.equal(captured?.url, "https://example.test/v1/chat/completions");
  assert.equal((captured?.init.headers as Record<string, string>).Authorization, `Bearer ${SECRET}`);
  assert.equal(JSON.parse(String(captured?.init.body)).model, "nvidia/test-model");
  assert.equal(result.output, "Hello");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  assert.ok(result.latencyMs >= 0);
});

test("usage is null when the provider omits it", async () => {
  const result = await runNemotron("hi", {
    config,
    fetchImpl: json(200, { choices: [{ message: { content: "ok" } }] }),
  });
  assert.equal(result.usage, null);
  assert.equal(result.model, "nvidia/test-model");
});

test("401 maps to auth_failed", async () => {
  const err = await expectError(json(401, { error: { message: "bad key" } }), "auth_failed");
  assert.equal(err.status, 401);
});

test("provider errors are truncated and redact an echoed key", async () => {
  const err = await expectError(
    json(500, { error: { message: `boom Authorization: Bearer ${SECRET} ${"x".repeat(500)}` } }),
    "provider_error",
  );
  assert.ok(err.message.length < 300);
});

test("timeout maps to timeout", async () => {
  const hang: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    });
  // AbortSignal.timeout uses an unref'd timer; keep the event loop alive until it fires.
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    await expectError(hang, "timeout");
  } finally {
    clearInterval(keepAlive);
  }
});

test("network failure maps to network_error", async () => {
  await expectError(async () => {
    throw new TypeError("fetch failed");
  }, "network_error");
});

test("empty content maps to invalid_response", async () => {
  await expectError(json(200, { choices: [{ message: { content: "" }, finish_reason: "length" }] }), "invalid_response");
});
