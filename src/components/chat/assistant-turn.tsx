"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCallRow } from "@/components/activity/tool-call-item";
import { proseClasses } from "./chat-message";
import type { ConversationToolCall } from "@/app/api/chat/activity/route";
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

export function AssistantTurn({
  thinking,
  toolCalls,
  text,
  isStreaming,
}: {
  thinking?: string;
  toolCalls?: ConversationToolCall[];
  text: string;
  isStreaming?: boolean;
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
        {(text || !isStreaming) && (
          <div className={proseClasses}>
            <Markdown remarkPlugins={[remarkGfm]}>{text || "\u200b"}</Markdown>
          </div>
        )}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3 ml-0.5 bg-current animate-pulse" />
        )}
      </div>
    </div>
  );
}
