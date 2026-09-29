import "server-only";

import type { ContextPolicy } from "../harness/types";

/** JSON-Schema-shaped parameters, passed straight through to the model's tool spec. */
export type ToolParameterSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolExecutionResult {
  /** Whether the tool call succeeded. */
  ok: boolean;
  /** Text sent back to the model as the tool result. Kept short. */
  content: string;
}

export type ToolExecutor = (call: ToolCall) => Promise<ToolExecutionResult>;

export interface AgentToolCallRecord {
  id: string;
  name: string;
  /** Arguments as sent by the model, after secret redaction and truncation. */
  arguments: Record<string, unknown>;
  ok: boolean;
  /** Short, truncated summary of the tool result (not the full payload). */
  resultSummary: string;
  /** Actual character length of the content sent back to the model (before evidence truncation), i.e. what future turns pay to resend. */
  resultChars: number;
}

/** One tool result whose content was replaced with a bounded summary by the "compact" context policy on this turn. */
export interface ContextCompactionEvent {
  toolName: string;
  /** File path, command, or other identifier for what the result was about — kept even when the content is dropped. */
  identifier: string;
  originalChars: number;
  compactedChars: number;
}

/** Token/size accounting for one request to the model, to explain where cost comes from. */
export interface AgentRequestMeta {
  /** Number of messages in the conversation sent on this request (system + user + all prior turns). */
  messageCount: number;
  /** Approximate serialized size of the request body, in characters. */
  serializedSizeChars: number;
  contextPolicy: ContextPolicy;
  /** Identifiers of tool results still present verbatim in this request. */
  preservedToolResultIdentifiers: string[];
  /** Identifiers of tool results already compacted by a prior turn (still compacted, not re-expanded). */
  compactedToolResultIdentifiers: string[];
  /** Tool results compacted for the FIRST time on this specific turn. */
  newCompactionEvents: ContextCompactionEvent[];
}

export interface AgentTurnRecord {
  turn: number;
  model: string;
  assistantContent: string | null;
  toolCalls: AgentToolCallRecord[];
  startedAt: string;
  durationMs: number;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
  request: AgentRequestMeta;
}

/**
 * Why the agent loop stopped. "completed" and "max_turns" are the two
 * ordinary outcomes; "timeout"/"provider_error"/"tool_error" mean the loop
 * ended early because something broke, not because the agent finished or
 * ran out of turns. This matters for diagnosis: a FAIL from "max_turns"
 * means the agent was still working; a FAIL from "provider_error" means
 * HarnessLab never got a fair look at the agent's ability on this turn.
 */
export type AgentTerminationReason = "completed" | "max_turns" | "timeout" | "tool_error" | "provider_error";

export interface AgentTrajectory {
  turns: AgentTurnRecord[];
  toolCallCount: number;
  stopReason: AgentTerminationReason;
  /** Human-readable detail for non-"completed"/"max_turns" stops (e.g. the provider error message). Null otherwise. */
  terminationDetail: string | null;
  finalAssistantMessage: string | null;
  totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
}
