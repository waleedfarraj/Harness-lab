import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDuration } from "../src/duration";

test("a bare number is milliseconds", () => {
  assert.equal(parseDuration("100"), 100);
});

test("an explicit ms suffix is milliseconds", () => {
  assert.equal(parseDuration("100ms"), 100);
});

test("seconds are converted to milliseconds", () => {
  assert.equal(parseDuration("1s"), 1000);
});

test("a unit word with a space before it still parses", () => {
  assert.equal(parseDuration("2 min"), 120_000);
});

test("units are case-insensitive", () => {
  assert.equal(parseDuration("3H"), 3 * 60 * 60 * 1000);
});

test("decimal values are supported", () => {
  assert.equal(parseDuration("1.5h"), 1.5 * 60 * 60 * 1000);
});

test("negative values are supported", () => {
  assert.equal(parseDuration("-100ms"), -100);
});

test("an unrecognized unit returns undefined, not a thrown error", () => {
  assert.equal(parseDuration("100xyz"), undefined);
});

test("days are converted to milliseconds", () => {
  assert.equal(parseDuration("2d"), 2 * 24 * 60 * 60 * 1000);
});
