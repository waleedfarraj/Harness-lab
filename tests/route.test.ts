import assert from "node:assert/strict";
import { test } from "node:test";
import { devRoutesEnabled } from "../src/lib/dev-routes";
import { POST } from "../src/app/api/nemotron/test/route";

process.env.HARNESSLAB_ENABLE_DEV_ROUTES = "1";

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

test("the route is a 404 unless dev routes are explicitly enabled (public deployments must not spend credits)", async () => {
  const saved = process.env.HARNESSLAB_ENABLE_DEV_ROUTES;
  try {
    delete process.env.HARNESSLAB_ENABLE_DEV_ROUTES;
    assert.equal(devRoutesEnabled(), false);
    const res = await post(JSON.stringify({ prompt: "hi" }));
    assert.equal(res.status, 404);
    process.env.HARNESSLAB_ENABLE_DEV_ROUTES = "true";
    assert.equal(devRoutesEnabled(), false, 'only "1" enables it');
  } finally {
    if (saved === undefined) delete process.env.HARNESSLAB_ENABLE_DEV_ROUTES;
    else process.env.HARNESSLAB_ENABLE_DEV_ROUTES = saved;
  }
});

test("dev routes stay off on Vercel even if the flag is set", () => {
  assert.equal(devRoutesEnabled({ HARNESSLAB_ENABLE_DEV_ROUTES: "1" }), true);
  assert.equal(devRoutesEnabled({ HARNESSLAB_ENABLE_DEV_ROUTES: "1", VERCEL: "1" }), false);
});
