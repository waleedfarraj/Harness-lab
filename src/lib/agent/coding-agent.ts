import "server-only";

import { NebiusError } from "../nebius/client";
import { ConfigError, loadNebiusConfig, type NebiusConfig } from "../nebius/config";
import type { AgentStopReason, AgentToolCallRecord, AgentTrajectory, AgentTurnRecord, ToolDefinition, ToolExecutor } from "./types";

/**
 * A small, bounded tool-calling loop against Nemotron Super via Token
 * Factory's OpenAI-compatible Chat Completions endpoint. This is
 * deliberately separate from `runNemotron()` (the Milestone 0 smoke test):
 * that one sends a single prompt and returns text; this one drives a
 * multi-turn conversation with function/tool calls.
 */

const SYSTEM_PROMPT = [
  "You are a careful senior software engineer working inside a small, isolated Git repository.",
  "You can only interact with the repository through the provided tools.",
  "Read the relevant files first, then make the smallest correct change.",
  "Run the tests before you consider the task finished.",
  "When you are satisfied the task is complete, reply with a short plain-text summary and do not call any more tools.",
].join(" ");

const MAX_OUTPUT_TOKENS_PER_TURN = 1024;

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

export interface RunCodingAgentOptions {
  instruction: string;
  toolDefinitions: ToolDefinition[];
  executeTool: ToolExecutor;
  maxTurns: number;
  /** Overall wall-clock budget for the whole loop, independent of the per-request timeout. */
  signal?: AbortSignal;
  /** Injected for tests; defaults to process.env-based config. */
  config?: NebiusConfig;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export async function runCodingAgent(options: RunCodingAgentOptions): Promise<AgentTrajectory> {
  let config: NebiusConfig;
  try {
    config = options.config ?? loadNebiusConfig();
  } catch (err) {
    if (err instanceof ConfigError) throw new NebiusError("config_missing", err.message);
    throw err;
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  const openAiTools = options.toolDefinitions.map((tool) => ({
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));

  const messages: OpenAiMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: options.instruction },
  ];

  const turns: AgentTurnRecord[] = [];
  let toolCallCount = 0;
  let stopReason: AgentStopReason = "max_turns";
  let finalAssistantMessage: string | null = null;
  const totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  for (let turn = 1; turn <= options.maxTurns; turn++) {
    if (options.signal?.aborted) {
      stopReason = "timeout";
      break;
    }

    const startedAt = new Date();
    const started = performance.now();
    const requestSignal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(config.timeoutMs)])
      : AbortSignal.timeout(config.timeoutMs);

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
          messages,
          tools: openAiTools,
          tool_choice: "auto",
          max_tokens: MAX_OUTPUT_TOKENS_PER_TURN,
        }),
        signal: requestSignal,
        cache: "no-store",
      });
    } catch (err) {
      if (options.signal?.aborted) {
        stopReason = "timeout";
        break;
      }
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new NebiusError("timeout", `Token Factory did not respond within ${config.timeoutMs} ms`);
      }
      throw new NebiusError("network_error", "Could not reach Token Factory (network error)");
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new NebiusError("auth_failed", `Token Factory rejected the request (HTTP ${response.status})`, response.status);
      }
      throw new NebiusError("provider_error", `Token Factory returned HTTP ${response.status}`, response.status);
    }

    const data = asRecord(body);
    const choice = asRecord(Array.isArray(data?.choices) ? data.choices[0] : undefined);
    const message = asRecord(choice?.message);
    const assistantContent = typeof message?.content === "string" ? message.content : null;
    const rawToolCalls = Array.isArray(message?.tool_calls) ? (message.tool_calls as OpenAiToolCall[]) : [];

    const usage = asRecord(data?.usage);
    const turnUsage = usage
      ? {
          inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
          outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
          totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
        }
      : null;
    if (turnUsage) {
      totalUsage.inputTokens += turnUsage.inputTokens ?? 0;
      totalUsage.outputTokens += turnUsage.outputTokens ?? 0;
      totalUsage.totalTokens += turnUsage.totalTokens ?? 0;
    }

    messages.push({
      role: "assistant",
      content: assistantContent,
      ...(rawToolCalls.length > 0 ? { tool_calls: rawToolCalls } : {}),
    });

    const toolCallRecords: AgentToolCallRecord[] = [];

    if (rawToolCalls.length === 0) {
      finalAssistantMessage = assistantContent;
      turns.push({
        turn,
        model: typeof data?.model === "string" ? data.model : config.model,
        assistantContent,
        toolCalls: [],
        startedAt: startedAt.toISOString(),
        durationMs: Math.round(performance.now() - started),
        usage: turnUsage,
      });
      stopReason = "completed";
      break;
    }

    for (const call of rawToolCalls) {
      toolCallCount += 1;
      let args: Record<string, unknown> = {};
      let parseError: string | null = null;
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        parseError = "invalid JSON arguments";
      }

      const result = parseError
        ? { ok: false, content: `error: ${parseError}` }
        : await options.executeTool({ name: call.function.name, arguments: args });

      messages.push({ role: "tool", tool_call_id: call.id, content: result.content });
      toolCallRecords.push({
        id: call.id,
        name: call.function.name,
        arguments: redactArgsForEvidence(call.function.name, args),
        ok: result.ok,
        resultSummary: result.content.length > 500 ? `${result.content.slice(0, 500)}...` : result.content,
      });
    }

    turns.push({
      turn,
      model: typeof data?.model === "string" ? data.model : config.model,
      assistantContent,
      toolCalls: toolCallRecords,
      startedAt: startedAt.toISOString(),
      durationMs: Math.round(performance.now() - started),
      usage: turnUsage,
    });
  }

  return { turns, toolCallCount, stopReason, finalAssistantMessage, totalUsage };
}

/** Keeps evidence small and never lets a write_file's full content ride along in the trajectory log. */
function redactArgsForEvidence(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (toolName === "write_file" && typeof args.content === "string") {
    const content = args.content;
    return { ...args, content: content.length > 300 ? `${content.slice(0, 300)}... [${content.length} chars total]` : content };
  }
  return args;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
