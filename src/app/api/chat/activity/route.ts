import { NextRequest, NextResponse } from "next/server";
import { sendGatewayRequest } from "@/lib/gateway-ingestor";
import { formatArgsSummary } from "@/lib/format-args";

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
}

export interface ConversationToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  argsSummary: string;
  result: unknown | null;
  isError: boolean;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  toolCalls?: ConversationToolCall[];
}

/** Strip ANSI escape sequences (SGR, cursor movement, DEC private mode, etc.) */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]|\x1B\][^\x07]*\x07|\x1B[()][A-Z0-9]/g, "");
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
        // Gateway user messages may include system context with ANSI codes
        const text = stripAnsi(raw);
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
              argsSummary: formatArgsSummary(
                block.name,
                block.arguments ?? {}
              ),
              result: null,
              isError: false,
            };
            pendingCalls.set(block.id, tc);
            toolCalls.push(tc);
          }
        }

        const turn: ConversationTurn = {
          role: "assistant",
          text: textParts.join(""),
        };
        if (thinkingParts.length > 0) {
          turn.thinking = thinkingParts.join("\n");
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

    return NextResponse.json({ turns });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
