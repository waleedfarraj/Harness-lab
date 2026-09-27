import "server-only";

/**
 * Server-side Token Factory configuration.
 *
 * Values come from process.env (populated from .env.local by Next.js).
 * None of these variables use the NEXT_PUBLIC_ prefix, so Next.js never
 * inlines them into client bundles.
 */

export const DEFAULT_BASE_URL = "https://api.tokenfactory.us-central1.nebius.com/v1";
export const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
export const DEFAULT_TIMEOUT_MS = 60_000;

export interface NebiusConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid Token Factory configuration: ${problems.join("; ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

/** Reads and validates config. Throws ConfigError; never includes secret values in messages. */
export function loadNebiusConfig(env: Env = process.env): NebiusConfig {
  const problems: string[] = [];

  const apiKey = env.NEBIUS_API_KEY?.trim() ?? "";
  if (!apiKey) {
    problems.push("NEBIUS_API_KEY is not set (add it to .env.local)");
  }

  const baseUrl = (env.NEBIUS_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") {
      problems.push("NEBIUS_BASE_URL must use https");
    }
  } catch {
    problems.push("NEBIUS_BASE_URL is not a valid URL");
  }

  const model = env.NEBIUS_MODEL?.trim() || DEFAULT_MODEL;

  const rawTimeout = env.NEBIUS_TIMEOUT_MS?.trim();
  const timeoutMs = rawTimeout ? Number(rawTimeout) : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    problems.push("NEBIUS_TIMEOUT_MS must be a positive integer");
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return { apiKey, baseUrl, model, timeoutMs };
}
