import "server-only";

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
}

export interface AgentTurnRecord {
  turn: number;
  model: string;
  assistantContent: string | null;
  toolCalls: AgentToolCallRecord[];
  startedAt: string;
  durationMs: number;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
}

export type AgentStopReason = "completed" | "max_turns" | "timeout" | "error";

export interface AgentTrajectory {
  turns: AgentTurnRecord[];
  toolCallCount: number;
  stopReason: AgentStopReason;
  finalAssistantMessage: string | null;
  totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
}
