import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, DEFAULT_BASE_URL, DEFAULT_MODEL, loadNebiusConfig } from "../src/lib/nebius/config";

test("missing API key produces a useful ConfigError", () => {
  assert.throws(() => loadNebiusConfig({}), (err: unknown) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /NEBIUS_API_KEY is not set/);
    return true;
  });
});

test("defaults are applied and trailing slashes trimmed", () => {
  assert.deepEqual(loadNebiusConfig({ NEBIUS_API_KEY: "k" }), {
    apiKey: "k",
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    timeoutMs: 60_000,
  });
  const cfg = loadNebiusConfig({ NEBIUS_API_KEY: "k", NEBIUS_BASE_URL: "https://example.test/v1/" });
  assert.equal(cfg.baseUrl, "https://example.test/v1");
});

test("rejects non-https base URL and bad timeout without echoing the key", () => {
  const secret = "sk-super-secret";
  assert.throws(
    () => loadNebiusConfig({ NEBIUS_API_KEY: secret, NEBIUS_BASE_URL: "http://x.test", NEBIUS_TIMEOUT_MS: "abc" }),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.problems.length, 2);
      assert.ok(!err.message.includes(secret));
      return true;
    },
  );
});
