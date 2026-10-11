import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDuration } from "../src/duration";
import { MAX_INPUT_LENGTH } from "../src/durationContract";

/**
 * Evaluator-only tests. Not shown to the coding agent while it works. These
 * check the one requirement that's only stated in durationContract.ts, not
 * exercised by the public tests: an input longer than MAX_INPUT_LENGTH must
 * return undefined, never throw.
 */

test("a string longer than MAX_INPUT_LENGTH returns undefined, not a thrown error", () => {
  const tooLong = "1" + " ".repeat(MAX_INPUT_LENGTH) + "ms";
  assert.ok(tooLong.length > MAX_INPUT_LENGTH);
  assert.doesNotThrow(() => parseDuration(tooLong));
  assert.equal(parseDuration(tooLong), undefined);
});

test("a negative decimal with a unit computes correctly", () => {
  assert.equal(parseDuration("-2.5d"), -2.5 * 24 * 60 * 60 * 1000);
});

test("a string exactly at MAX_INPUT_LENGTH still parses normally when valid", () => {
  const padded = "1" + " ".repeat(MAX_INPUT_LENGTH - "1ms".length) + "ms";
  assert.equal(padded.length, MAX_INPUT_LENGTH);
  assert.equal(parseDuration(padded), 1);
});
