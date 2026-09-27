/** Wire format of POST /api/nemotron/test, shared by the route and the page. */

export interface NemotronTestSuccess {
  success: true;
  model: string;
  output: string;
  latencyMs: number;
  finishReason: string | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } | null;
}

export interface NemotronTestFailure {
  success: false;
  error: { code: string; message: string };
}

export type NemotronTestResponse = NemotronTestSuccess | NemotronTestFailure;
