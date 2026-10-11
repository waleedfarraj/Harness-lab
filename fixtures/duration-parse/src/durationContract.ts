/**
 * Duration-string parsing contract.
 *
 * Behavior is modeled on the `ms` npm package (https://github.com/vercel/ms),
 * `index.js`, tag `2.1.3`, commit 1c6264b795492e8fdecbc82cb8802fcfbfc08d26,
 * MIT License, Copyright (c) 2020 Vercel, Inc. See THIRD_PARTY_NOTICES.md in
 * this fixture directory for the full license text. No source code from that
 * repository is copied here — only its documented parsing behavior is used
 * as this task's specification.
 *
 * parseDuration(input) converts a human-readable duration string to a
 * number of milliseconds:
 *  - A bare number (e.g. "100") is milliseconds.
 *  - A number optionally followed by a space and a unit, case-insensitive:
 *    ms | s/sec/secs/second/seconds | m/min/mins/minute/minutes |
 *    h/hr/hrs/hour/hours | d/day/days.
 *  - Negative numbers and decimals are both valid (e.g. "-1.5h").
 *  - A string that does not match this grammar (wrong unit, garbage input)
 *    returns `undefined` — never throws, never NaN.
 *
 * IMPORTANT: a string longer than MAX_INPUT_LENGTH characters is not a
 * parse error — it must also return `undefined` without throwing. This
 * guards against pathological input and matches the upstream project's own
 * length guard exactly.
 */
export const MAX_INPUT_LENGTH = 100;
