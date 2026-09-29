import "server-only";

import type { ContextPolicy, Skill } from "../harness/types";
import { NebiusError } from "../nebius/client";
import { ConfigError, loadNebiusConfig, type NebiusConfig } from "../nebius/config";
import type {
  AgentTerminationReason,
  AgentToolCallRecord,
  AgentTrajectory,
  AgentTurnRecord,
  ContextCompactionEvent,
  ToolDefinition,
  ToolExecutor,
} from "./types";

/**
 * A small, bounded tool-calling loop against Nemotron Super via Token
 * Factory's OpenAI-compatible Chat Completions endpoint. This is
 * deliberately separate from `runNemotron()` (the Milestone 0 smoke test):
 * that one sends a single prompt and returns text; this one drives a
 * multi-turn conversation with function/tool calls.
 *
 * `model` and `systemPrompt` are required, explicit inputs (from a
 * HarnessManifest), not hidden constants here — that's what makes two
 * harness configurations comparable. `skills` and `contextPolicy`
 * (Milestone 4) are the same kind of explicit input: skill content is
 * injected into the system message, and the context policy genuinely
 * changes what later turns see (see `applyContextPolicy` below) — neither
 * is a label bolted on after the fact.
 */

const MAX_OUTPUT_TOKENS_PER_TURN = 1024;

/**
 * Deterministic "compact" context policy tuning. Grounded in Milestone 2's
 * real per-turn telemetry (payment-retry request bodies were ~2.8k chars at
 * turn 1, ~8.6k by turn 4): a 3500-char trigger means compaction stays
 * inactive for the first turn or two of a small fixture, then starts
 * trimming once the conversation is genuinely growing — not from turn one.
 */
const COMPACT_TRIGGER_CHARS = 3500;
const COMPACT_KEEP_RECENT_TOOL_RESULTS = 2;

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

/** Per-message bookkeeping, index-aligned with `messages`. Only tool-role messages carry metadata. */
interface ToolMessageMeta {
  toolName: string;
  identifier: string;
  originalChars: number;
  compacted: boolean;
}

export interface RunCodingAgentOptions {
  /** Which model to request. Explicit — from a HarnessManifest, never a hidden default. */
  model: string;
  /** The system message. Explicit — from a HarnessManifest, never a hidden default. */
  systemPrompt: string;
  /** Skill content, appended to the system message as clearly delimited, versioned sections. */
  skills: Skill[];
  contextPolicy: ContextPolicy;
  instruction: string;
  toolDefinitions: ToolDefinition[];
  executeTool: ToolExecutor;
  maxTurns: number;
  /** Overall wall-clock budget for the whole loop, independent of the per-request timeout. */
  signal?: AbortSignal;
  /** Injected for tests; defaults to process.env-based config (apiKey/baseUrl/timeoutMs only — model comes from `options.model`). */
  config?: NebiusConfig;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

function buildSystemMessage(systemPrompt: string, skills: Skill[]): string {
  const sections = skills.map((skill) => `\n\n## Skill: ${skill.id}\n${skill.content}`);
  return systemPrompt + sections.join("");
}

function toolResultIdentifier(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
    case "write_file":
      return typeof args.path === "string" ? args.path : "?";
    case "list_files":
      return typeof args.path === "string" ? args.path : ".";
    case "run_command":
      return typeof args.command === "string" ? args.command : "?";
    case "git_diff":
      return "git_diff";
    default:
      return toolName;
  }
}

/**
 * Deterministic context compaction — no model involved. Once the serialized
 * conversation exceeds `COMPACT_TRIGGER_CHARS`, every tool result older than
 * the most recent `COMPACT_KEEP_RECENT_TOOL_RESULTS` gets its content
 * replaced with a short, bounded summary that keeps the tool name and
 * identifier (e.g. the file path) but drops the body. System message, task,
 * and skill content live in messages[0]/[1] and are never touched — only
 * tool-role messages are ever eligible. Already-compacted messages are
 * skipped (compaction never re-expands).
 */
export function applyContextPolicy(
  messages: OpenAiMessage[],
  messageMeta: (ToolMessageMeta | null)[],
  policy: ContextPolicy,
): ContextCompactionEvent[] {
  if (policy === "full") return [];

  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  if (totalChars <= COMPACT_TRIGGER_CHARS) return [];

  const toolIndices: number[] = [];
  for (let i = 0; i < messageMeta.length; i++) {
    if (messageMeta[i]) toolIndices.push(i);
  }
  const eligible = toolIndices.slice(0, Math.max(0, toolIndices.length - COMPACT_KEEP_RECENT_TOOL_RESULTS));

  const events: ContextCompactionEvent[] = [];
  for (const i of eligible) {
    const meta = messageMeta[i];
    if (!meta || meta.compacted) continue;
    const summary = `[compacted ${meta.toolName} result for ${meta.identifier}: ${meta.originalChars} chars omitted]`;
    messages[i] = { ...messages[i], content: summary };
    meta.compacted = true;
    events.push({ toolName: meta.toolName, identifier: meta.identifier, originalChars: meta.originalChars, compactedChars: summary.length });
  }
  return events;
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
    { role: "system", content: buildSystemMessage(options.systemPrompt, options.skills) },
    { role: "user", content: options.instruction },
  ];
  const messageMeta: (ToolMessageMeta | null)[] = [null, null];

  const turns: AgentTurnRecord[] = [];
  let toolCallCount = 0;
  let stopReason: AgentTerminationReason = "max_turns";
  let terminationDetail: string | null = null;
  let finalAssistantMessage: string | null = null;
  const totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  turnLoop: for (let turn = 1; turn <= options.maxTurns; turn++) {
    if (options.signal?.aborted) {
      stopReason = "timeout";
      terminationDetail = "Experiment wall-clock timeout exceeded";
      break;
    }

    const startedAt = new Date();
    const started = performance.now();
    const requestSignal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(config.timeoutMs)])
      : AbortSignal.timeout(config.timeoutMs);

    const newCompactionEvents = applyContextPolicy(messages, messageMeta, options.contextPolicy);
    const preservedToolResultIdentifiers: string[] = [];
    const compactedToolResultIdentifiers: string[] = [];
    for (const meta of messageMeta) {
      if (!meta) continue;
      (meta.compacted ? compactedToolResultIdentifiers : preservedToolResultIdentifiers).push(meta.identifier);
    }

    const requestMessageCount = messages.length;
    const requestBody = {
      model: options.model,
      messages,
      tools: openAiTools,
      tool_choice: "auto",
      max_tokens: MAX_OUTPUT_TOKENS_PER_TURN,
    };
    const serializedBody = JSON.stringify(requestBody);
    const requestMeta = {
      messageCount: requestMessageCount,
      serializedSizeChars: serializedBody.length,
      contextPolicy: options.contextPolicy,
      preservedToolResultIdentifiers,
      compactedToolResultIdentifiers,
      newCompactionEvents,
    };

    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: serializedBody,
        signal: requestSignal,
        cache: "no-store",
      });
    } catch (err) {
      if (options.signal?.aborted) {
        stopReason = "timeout";
        terminationDetail = "Experiment wall-clock timeout exceeded";
        break;
      }
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        stopReason = "timeout";
        terminationDetail = `Token Factory did not respond within ${config.timeoutMs} ms`;
        break;
      }
      stopReason = "provider_error";
      terminationDetail = "Could not reach Token Factory (network error)";
      break;
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      stopReason = "provider_error";
      terminationDetail =
        response.status === 401 || response.status === 403
          ? `Token Factory rejected the request as unauthorized (HTTP ${response.status})`
          : `Token Factory returned HTTP ${response.status}`;
      break;
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
    messageMeta.push(null);

    const toolCallRecords: AgentToolCallRecord[] = [];

    if (rawToolCalls.length === 0) {
      finalAssistantMessage = assistantContent;
      turns.push({
        turn,
        model: typeof data?.model === "string" ? data.model : options.model,
        assistantContent,
        toolCalls: [],
        startedAt: startedAt.toISOString(),
        durationMs: Math.round(performance.now() - started),
        usage: turnUsage,
        request: requestMeta,
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

      let result: { ok: boolean; content: string };
      if (parseError) {
        result = { ok: false, content: `error: ${parseError}` };
      } else {
        try {
          result = await options.executeTool({ name: call.function.name, arguments: args });
        } catch (err) {
          // The tool layer catches its own expected failures (bad path, disallowed command, etc.)
          // and returns { ok: false }; reaching here means the executor itself broke unexpectedly.
          stopReason = "tool_error";
          terminationDetail = err instanceof Error ? err.message : "tool executor threw an unexpected error";
          break turnLoop;
        }
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: result.content });
      messageMeta.push({
        toolName: call.function.name,
        identifier: toolResultIdentifier(call.function.name, args),
        originalChars: result.content.length,
        compacted: false,
      });
      toolCallRecords.push({
        id: call.id,
        name: call.function.name,
        arguments: redactArgsForEvidence(call.function.name, args),
        ok: result.ok,
        resultSummary: result.content.length > 500 ? `${result.content.slice(0, 500)}...` : result.content,
        resultChars: result.content.length,
      });
    }

    turns.push({
      turn,
      model: typeof data?.model === "string" ? data.model : options.model,
      assistantContent,
      toolCalls: toolCallRecords,
      startedAt: startedAt.toISOString(),
      durationMs: Math.round(performance.now() - started),
      usage: turnUsage,
      request: requestMeta,
    });
  }

  return { turns, toolCallCount, stopReason, terminationDetail, finalAssistantMessage, totalUsage };
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
