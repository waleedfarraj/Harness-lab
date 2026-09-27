import { NebiusError, runNemotron, type NebiusErrorCode } from "@/lib/nebius/client";
import type { NemotronTestFailure, NemotronTestSuccess } from "@/types/nemotron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT_LENGTH = 8_000;

const STATUS_BY_CODE: Record<NebiusErrorCode, number> = {
  config_missing: 500,
  auth_failed: 502,
  provider_error: 502,
  invalid_response: 502,
  network_error: 502,
  timeout: 504,
};

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const prompt =
    typeof body === "object" && body !== null ? (body as { prompt?: unknown }).prompt : undefined;

  if (typeof prompt !== "string" || prompt.trim() === "") {
    return fail("malformed_request", 'Request body must be JSON: { "prompt": "<non-empty string>" }', 400);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return fail("malformed_request", `Prompt must be at most ${MAX_PROMPT_LENGTH} characters`, 400);
  }

  try {
    const result = await runNemotron(prompt);
    return Response.json({
      success: true,
      model: result.model,
      output: result.output,
      latencyMs: result.latencyMs,
      finishReason: result.finishReason,
      usage: result.usage,
    } satisfies NemotronTestSuccess);
  } catch (err) {
    if (err instanceof NebiusError) {
      // Log code/status only; messages are already sanitized but keep logs minimal.
      console.error(`[nemotron] ${err.code}${err.status ? ` (HTTP ${err.status})` : ""}`);
      return fail(err.code, err.message, STATUS_BY_CODE[err.code]);
    }
    console.error("[nemotron] unexpected error");
    return fail("internal_error", "Unexpected server error", 500);
  }
}

function fail(code: string, message: string, status: number): Response {
  return Response.json({ success: false, error: { code, message } } satisfies NemotronTestFailure, { status });
}
