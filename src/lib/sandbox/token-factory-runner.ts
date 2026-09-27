import type { SandboxExecResult, SandboxHandle, SandboxRunner } from "./types";

export class SandboxNotConfiguredError extends Error {
  constructor(operation: string) {
    super(
      `Token Factory Sandbox access not configured: cannot ${operation}. ` +
        "Sandbox beta access is pending; implement this adapter once the API is documented.",
    );
    this.name = "SandboxNotConfiguredError";
  }
}

/**
 * Placeholder adapter. Intentionally performs no work and fakes nothing:
 * every method fails loudly until real Token Factory Sandbox access exists.
 * (Parameters are omitted because they are unused; the signatures still satisfy SandboxRunner.)
 */
export class TokenFactorySandboxRunner implements SandboxRunner {
  async create(): Promise<SandboxHandle> {
    throw new SandboxNotConfiguredError("create a sandbox");
  }

  async execute(): Promise<SandboxExecResult> {
    throw new SandboxNotConfiguredError("execute a command");
  }

  async destroy(): Promise<void> {
    throw new SandboxNotConfiguredError("destroy a sandbox");
  }
}
