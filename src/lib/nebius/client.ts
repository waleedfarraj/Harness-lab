import "server-only";

import { ConfigError, loadNebiusConfig, type NebiusConfig } from "./config";

/**
 * The only module that talks to Nebius Token Factory.
 * Uses the OpenAI-compatible Chat Completions endpoint via fetch (no SDK).
 */

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface NemotronResult {
  model: string;
  output: string;
  latencyMs: number;
  finishReason: string | null;
  /** null when the provider returned no usage block. */
  usage: TokenUsage | null;
}

export type NebiusErrorCode =
  | "config_missing"
  | "auth_failed"
  | "provider_error"
  | "timeout"
  | "network_error"
  | "invalid_response";

/** Error with a message that is always safe to show to the browser. */
export class NebiusError extends Error {
  readonly code: NebiusErrorCode;
  readonly status?: number;

  constructor(code: NebiusErrorCode, message: string, status?: number) {
    super(message);
    this.name = "NebiusError";
    this.code = code;
    this.status = status;
  }
}

export interface RunOptions {
  maxTokens?: number;
  /** Injected for tests; defaults to process.env-based config. */
  config?: NebiusConfig;
  fetchImpl?: typeof fetch;
}

const MAX_PROVIDER_MESSAGE_LENGTH = 200;

export async function runNemotron(prompt: string, options: RunOptions = {}): Promise<NemotronResult> {
  let config: NebiusConfig;
  try {
    config = options.config ?? loadNebiusConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      throw new NebiusError("config_missing", err.message);
    }
    throw err;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const started = performance.now();

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: options.maxTokens ?? 1024,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new NebiusError("timeout", `Token Factory did not respond within ${config.timeoutMs} ms`);
    }
    throw new NebiusError("network_error", "Could not reach Token Factory (network error)");
  }

  const latencyMs = Math.round(performance.now() - started);
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = providerMessage(body, config.apiKey);
    if (response.status === 401 || response.status === 403) {
      throw new NebiusError(
        "auth_failed",
        `Token Factory rejected the request as unauthorized (HTTP ${response.status}). ` +
          "Check NEBIUS_API_KEY and that the key can access NEBIUS_MODEL.",
        response.status,
      );
    }
    throw new NebiusError(
      "provider_error",
      `Token Factory returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }

  return parseCompletion(body, config.model, latencyMs);
}

function parseCompletion(body: unknown, configuredModel: string, latencyMs: number): NemotronResult {
  const data = asRecord(body);
  const choice = asRecord(Array.isArray(data?.choices) ? data.choices[0] : undefined);
  const message = asRecord(choice?.message);
  const content = message?.content;

  if (typeof content !== "string" || content.trim() === "") {
    const finish = typeof choice?.finish_reason === "string" ? ` (finish_reason: ${choice.finish_reason})` : "";
    throw new NebiusError("invalid_response", `Token Factory returned no text content${finish}`);
  }

  return {
    model: typeof data?.model === "string" ? data.model : configuredModel,
    output: content.trim(),
    latencyMs,
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    usage: parseUsage(data?.usage),
  };
}

function parseUsage(raw: unknown): TokenUsage | null {
  const usage = asRecord(raw);
  if (!usage) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const result = {
    inputTokens: num(usage.prompt_tokens),
    outputTokens: num(usage.completion_tokens),
    totalTokens: num(usage.total_tokens),
  };
  return Object.values(result).every((v) => v === null) ? null : result;
}

/** Extracts a short provider error message, redacting the key in case it is echoed back. */
function providerMessage(body: unknown, apiKey: string): string | null {
  const error = asRecord(body)?.error;
  const raw = typeof error === "string" ? error : asRecord(error)?.message;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const redacted = raw.split(apiKey).join("[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return redacted.length > MAX_PROVIDER_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_PROVIDER_MESSAGE_LENGTH)}…`
    : redacted;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
