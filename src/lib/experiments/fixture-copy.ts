import "server-only";

/**
 * Top-level fixture entries copied into a fresh workspace. `hidden/` is
 * deliberately excluded here — it must never be copied in, and must never be
 * compared against as if it should have been.
 */
export const FIXTURE_COPY_ENTRIES = ["package.json", "tsconfig.json", "src", "tests"] as const;
