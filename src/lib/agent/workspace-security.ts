import "server-only";

/**
 * Path/write policy shared by every SandboxRunner (local and remote). Pure
 * string validation only — no filesystem access — so it applies identically
 * regardless of whether the workspace behind it is a local temp directory or
 * a remote Token Factory Sandbox checkpoint.
 */

export class WorkspaceSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSecurityError";
  }
}

export const BLOCKED_SEGMENTS = new Set([".git", "node_modules"]);
const PROTECTED_FILES = new Set(["package.json", "tsconfig.json"]);
const PROTECTED_DIR_PREFIXES = ["tests/"];

/** Rejects absolute paths, "..", and any segment that touches a blocked directory. Doesn't touch the filesystem. */
export function assertSafeRelativePath(relPath: string): void {
  if (typeof relPath !== "string" || relPath.trim() === "") {
    throw new WorkspaceSecurityError("path must be a non-empty string");
  }
  if (relPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(relPath)) {
    throw new WorkspaceSecurityError(`absolute paths are not allowed: ${relPath}`);
  }
  const segments = relPath.split(/[\\/]+/);
  if (segments.includes("..")) {
    throw new WorkspaceSecurityError(`path traversal ("..") is not allowed: ${relPath}`);
  }
  if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment))) {
    throw new WorkspaceSecurityError(`path touches a blocked directory: ${relPath}`);
  }
}

/** Refuses to write tests/, package.json or tsconfig.json — the evaluator's integrity depends on the agent never touching these. */
export function assertWritablePath(relPath: string): void {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (PROTECTED_FILES.has(normalized)) {
    throw new WorkspaceSecurityError(`refusing to modify protected file: ${relPath}`);
  }
  if (PROTECTED_DIR_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new WorkspaceSecurityError(`refusing to modify public tests: ${relPath}`);
  }
}
