"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, XCircle } from "lucide-react";
import { ToolCallRow } from "@/components/activity/tool-call-item";
import { proseClasses } from "./chat-message";
import type { ConversationToolCall, TurnError } from "@/app/api/chat/activity/route";
import type { ToolCallItem } from "@/components/activity/use-agent-activity";

function toToolCallItem(tc: ConversationToolCall): ToolCallItem {
  return {
    kind: "tool",
    id: tc.id,
    name: tc.name,
    argsSummary: tc.argsSummary,
    status: "done",
    startedAt: 0,
    result: tc.result,
  };
}

function errorTypeLabel(type: string): string {
  switch (type) {
    case "rate_limit_error": return "Rate limited";
    case "overloaded_error": return "API overloaded";
    case "api_error": return "API error";
    case "authentication_error": return "Auth error";
    default: return type.replace(/_/g, " ");
  }
}

export function AssistantTurn({
  thinking,
  toolCalls,
  text,
  isStreaming,
  error,
}: {
  thinking?: string;
  toolCalls?: ConversationToolCall[];
  text: string;
  isStreaming?: boolean;
  error?: TurnError;
}) {
  const [thinkingOpen, setThinkingOpen] = useState(false);

  return (
    <div className="flex w-full px-3 py-1.5 justify-start">
      <div className="max-w-[85%] rounded-lg px-3 py-2 text-xs break-words bg-muted text-foreground">
        {thinking && (
          <div className="mb-1.5">
            <button
              type="button"
              className="text-[0.65rem] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setThinkingOpen((o) => !o)}
            >
              {thinkingOpen ? "Hide" : "Show"} thinking
              {isStreaming && !text ? "..." : ""}
            </button>
            {thinkingOpen && (
              <div className="mt-1 pl-2 border-l-2 border-muted-foreground/30 text-muted-foreground whitespace-pre-wrap text-[0.65rem] max-h-48 overflow-y-auto">
                {thinking}
              </div>
            )}
          </div>
        )}
        {toolCalls && toolCalls.length > 0 && (
          <div className="space-y-0.5 mb-1.5">
            {toolCalls.map((tc) => (
              <ToolCallRow key={tc.id} item={toToolCallItem(tc)} />
            ))}
          </div>
        )}
        {text && (
          <div className={proseClasses}>
            <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
          </div>
        )}
        {error && (
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[0.65rem] ${
            error.isFinal
              ? "bg-red-500/10 border border-red-500/20 text-red-400"
              : "bg-yellow-500/10 border border-yellow-500/20 text-yellow-400"
          }`}>
            {error.isFinal ? (
              <XCircle className="h-3 w-3 shrink-0" />
            ) : (
              <AlertTriangle className="h-3 w-3 shrink-0" />
            )}
            <span>
              {errorTypeLabel(error.type)}
              {error.retryCount > 1 && ` (×${error.retryCount})`}
            </span>
          </div>
        )}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3 ml-0.5 bg-current animate-pulse" />
        )}
      </div>
    </div>
  );
}
