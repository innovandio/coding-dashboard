export type GatewayRequest = {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type GatewayResponse = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
};

export type GatewayEvent = {
  type: "event";
  event: string;
  payload: Record<string, unknown>;
};

export type GatewayMessage = GatewayRequest | GatewayResponse | GatewayEvent;

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting";

// Chat protocol types

export type SessionResolveParams = {
  agentId: string;
  label?: string;
};

export type ChatSendParams = {
  sessionKey: string;
  message: string;
  idempotencyKey: string;
};

export type ChatAbortParams = {
  sessionKey: string;
};

export type ChatHistoryParams = {
  sessionKey: string;
  limit?: number;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "error";
  message: ChatMessage;
};
