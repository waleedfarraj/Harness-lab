import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../src/app/api/nemotron/test/route";

const post = (body: string) =>
  POST(new Request("http://localhost/api/nemotron/test", { method: "POST", body }));

test("malformed JSON returns 400", async () => {
  const res = await post("{not json");
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, "malformed_request");
});

test("missing prompt returns 400", async () => {
  const res = await post(JSON.stringify({ prompt: "   " }));
  assert.equal(res.status, 400);
});

test("missing configuration returns 500 config_missing", async () => {
  const saved = process.env.NEBIUS_API_KEY;
  delete process.env.NEBIUS_API_KEY;
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = await post(JSON.stringify({ prompt: "hi" }));
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "config_missing");
    assert.match(body.error.message, /NEBIUS_API_KEY/);
  } finally {
    console.error = originalError;
    if (saved !== undefined) process.env.NEBIUS_API_KEY = saved;
  }
});
