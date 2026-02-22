import { NextRequest, NextResponse } from "next/server";
import { sendGatewayRequest } from "@/lib/gateway-ingestor";
import { formatArgsSummary } from "@/lib/format-args";
import { stripAnsi } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface HistoryMessage {
  role: string;
  content: string | ContentBlock[];
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  timestamp?: number;
  stopReason?: string;
  errorMessage?: string;
}

export interface ConversationToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  argsSummary: string;
  result: unknown | null;
  isError: boolean;
}

export interface TurnError {
  message: string;
  type: string;
  retryCount: number;
  isFinal: boolean;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  toolCalls?: ConversationToolCall[];
  error?: TurnError;
}

/** Parse an error message string (e.g. "429 {json}") into type + message. */
function parseErrorMessage(raw: string): { type: string; message: string } {
  try {
    const jsonStart = raw.indexOf("{");
    if (jsonStart !== -1) {
      const json = JSON.parse(raw.slice(jsonStart));
      const errObj = json.error ?? json;
      return {
        type: errObj.type ?? "unknown_error",
        message: errObj.message ?? raw,
      };
    }
  } catch {
    // ignore parse errors
  }
  return { type: "unknown_error", message: raw };
}

/**
 * Strip gateway metadata wrapper from user messages.
 * The gateway prepends: "Conversation info (untrusted metadata): ```json {...} ``` [timestamp] "
 */
function stripGatewayWrapper(str: string): string {
  // Match: everything up to and including a bracketed timestamp like [Fri 2026-02-20 08:48 UTC]
  const match = str.match(/^Conversation info\b[\s\S]*?\]\s*/);
  if (match) return str.slice(match[0].length);
  return str;
}

/** Strip routing tags like [[reply_to_current]] from assistant messages. */
function stripRoutingTags(str: string): string {
  return str.replace(/^\[\[[^\]]+\]\]\s*/g, "");
}

/**
 * Parses Gateway chat history into structured ConversationTurn[].
 * Each user message becomes a user turn; each assistant message becomes
 * an assistant turn with optional thinking, tool calls, and text.
 * toolResult messages attach results to the preceding assistant turn's tool calls.
 */
export async function GET(req: NextRequest) {
  const sessionKey = req.nextUrl.searchParams.get("session_key");
  if (!sessionKey) {
    return NextResponse.json({ error: "session_key required" }, { status: 400 });
  }

  try {
    const payload = await sendGatewayRequest("chat.history", {
      sessionKey,
      limit: 200,
    });

    const messages = (payload as { messages?: HistoryMessage[] }).messages ?? [];
    const turns: ConversationTurn[] = [];
    const pendingCalls = new Map<string, ConversationToolCall>();

    for (const msg of messages) {
      if (msg.role === "user") {
        const raw =
          typeof msg.content === "string"
            ? msg.content
            : (msg.content ?? [])
                .filter((b) => b.type === "text")
                .map((b) => b.text ?? "")
                .join("");
        // Gateway user messages include metadata wrapper and may have ANSI codes
        const text = stripGatewayWrapper(stripAnsi(raw));
        turns.push({ role: "user", text });
      } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const thinkingParts: string[] = [];
        const textParts: string[] = [];
        const toolCalls: ConversationToolCall[] = [];

        for (const block of msg.content) {
          if (block.type === "thinking" && block.thinking) {
            thinkingParts.push(block.thinking);
          } else if (block.type === "text" && block.text) {
            textParts.push(block.text);
          } else if (block.type === "toolCall" && block.id && block.name) {
            const tc: ConversationToolCall = {
              id: block.id,
              name: block.name,
              arguments: block.arguments ?? {},
              argsSummary: formatArgsSummary(block.name, block.arguments ?? {}),
              result: null,
              isError: false,
            };
            pendingCalls.set(block.id, tc);
            toolCalls.push(tc);
          }
        }

        const text = stripRoutingTags(textParts.join(""));
        const thinking = thinkingParts.join("\n");

        // Handle error responses (e.g. 429 rate limit, overloaded, etc.)
        if (msg.stopReason === "error" && msg.errorMessage) {
          const parsed = parseErrorMessage(msg.errorMessage);
          const lastTurn = turns[turns.length - 1];
          if (lastTurn?.error && lastTurn.error.type === parsed.type) {
            lastTurn.error.retryCount++;
          } else {
            turns.push({
              role: "assistant",
              text: text || "",
              error: {
                message: parsed.message,
                type: parsed.type,
                retryCount: 1,
                isFinal: false,
              },
            });
          }
          continue;
        }

        // Skip empty turns (tool-call-only with no text)
        if (!text && !thinking && toolCalls.length === 0) continue;

        const turn: ConversationTurn = {
          role: "assistant",
          text,
        };
        if (thinking) {
          turn.thinking = thinking;
        }
        if (toolCalls.length > 0) {
          turn.toolCalls = toolCalls;
        }
        turns.push(turn);
      } else if (msg.role === "toolResult" && msg.toolCallId) {
        const tc = pendingCalls.get(msg.toolCallId);
        if (tc) {
          tc.result = msg.details ?? msg.content;
          tc.isError = msg.isError ?? false;
        }
      }
    }

    // Mark trailing error turns as final (no successful response followed)
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].error) {
        turns[i].error!.isFinal = true;
      } else {
        break;
      }
    }

    return NextResponse.json({ turns });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
