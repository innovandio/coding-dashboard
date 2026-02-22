"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChatMessage } from "./chat-message";
import { AssistantTurn } from "./assistant-turn";
import { LifecycleBanner } from "./lifecycle-banner";
import { ChatInput } from "./chat-input";
import { useAgentActivity } from "@/components/activity/use-agent-activity";
import { formatArgsSummary } from "@/lib/format-args";
import { parseToolEvent, isToolComplete } from "@/lib/parse-tool-event";
import type {
  ConversationTurn,
  ConversationToolCall,
  TurnError,
} from "@/app/api/chat/activity/route";
import { stripAnsi } from "@/lib/utils";
import { toast } from "sonner";
import type { BusEvent } from "@/lib/event-bus";

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
}

/** Strip gateway metadata wrapper from user messages. */
function stripGatewayWrapper(str: string): string {
  const match = str.match(/^Conversation info\b[\s\S]*?\]\s*/);
  return match ? str.slice(match[0].length) : str;
}

/** Strip routing tags like [[reply_to_current]] from assistant messages. */
function stripRoutingTags(str: string): string {
  return str.replace(/^\[\[[^\]]+\]\]\s*/g, "");
}

function extractContent(raw: unknown): { thinking: string; text: string } {
  if (typeof raw === "string") return { thinking: "", text: raw };
  if (Array.isArray(raw)) {
    const blocks = raw as ContentBlock[];
    const thinking = blocks
      .filter((b) => b.type === "thinking")
      .map((b) => b.thinking ?? "")
      .join("");
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return { thinking, text };
  }
  return { thinking: "", text: "" };
}

type DisplayItem =
  | { type: "user"; id: string; text: string; ts?: number }
  | {
      type: "assistant";
      id: string;
      text: string;
      thinking?: string;
      toolCalls?: ConversationToolCall[];
      isStreaming?: boolean;
      error?: TurnError;
    };

export function ChatPanel({ projectId, events }: { projectId: string | null; events: BusEvent[] }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyTurns, setHistoryTurns] = useState<ConversationTurn[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { lifecycleState, runs } = useAgentActivity(events);

  // Resolve chat session when project changes
  useEffect(() => {
    setSessionId(null);
    setSessionKey(null);
    setHistoryTurns([]);
    setError(null);

    if (!projectId) return;

    const controller = new AbortController();
    setResolving(true);

    fetch("/api/chat/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.error) {
          setError(data.error);
        } else {
          setSessionId(data.sessionId);
          setSessionKey(data.sessionKey);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setResolving(false);
      });

    return () => {
      controller.abort();
    };
  }, [projectId]);

  // Track when history was last fetched so we only overlay genuinely new live items
  const [historyFetchedAt, setHistoryFetchedAt] = useState(0);

  // Fetch structured turns from Gateway history
  const fetchTurns = useCallback(async () => {
    if (!sessionKey) return;
    try {
      const res = await fetch(`/api/chat/activity?session_key=${encodeURIComponent(sessionKey)}`);
      if (!res.ok) return;
      const data = await res.json();
      setHistoryTurns(data.turns ?? []);
      setHistoryFetchedAt(Date.now());
    } catch {
      // History fetch failures are expected during connection setup
    }
  }, [sessionKey]);

  // Load when sessionKey resolves + refetch when lifecycle changes (run ends)
  useEffect(() => {
    fetchTurns();
  }, [fetchTurns, lifecycleState]);

  // Detect completed chat runs (final/error) — for immediate failures the
  // agent lifecycle may never fire, so we refetch history on completion.
  const chatCompletionCount = useMemo(() => {
    return events.filter((ev) => {
      if (ev.event_type !== "chat") return false;
      const p = ev.payload as Record<string, unknown>;
      return (p.state === "final" || p.state === "error") && p.sessionKey === sessionKey;
    }).length;
  }, [events, sessionKey]);

  useEffect(() => {
    if (chatCompletionCount > 0) fetchTurns();
  }, [chatCompletionCount, fetchTurns]);

  // Build live overlay from SSE events for the current in-progress run
  const liveItems = useMemo((): DisplayItem[] => {
    if (!sessionKey) return [];

    const matchingEvents = events.filter((ev) => {
      const payload = ev.payload as Record<string, unknown>;
      return payload.sessionKey === sessionKey;
    });

    // Track per-run state
    interface RunState {
      firstEventId: number;
      chatText: string;
      chatThinking: string;
      chatError: string | null;
      isFinal: boolean;
      agentText: string;
      agentThinking: string;
      agentEnded: boolean;
      toolCalls: Map<string, ConversationToolCall>;
    }
    const runStates = new Map<string, RunState>();
    const orderedItems: Array<
      | { eventId: number; type: "user"; text: string; id: string; ts: number }
      | { eventId: number; type: "run"; runId: string }
    > = [];
    const seenRunIds = new Set<string>();

    function getOrCreateRun(runId: string, eventId: number): RunState {
      let run = runStates.get(runId);
      if (!run) {
        run = {
          firstEventId: eventId,
          chatText: "",
          chatThinking: "",
          chatError: null,
          isFinal: false,
          agentText: "",
          agentThinking: "",
          agentEnded: false,
          toolCalls: new Map(),
        };
        runStates.set(runId, run);
        if (!seenRunIds.has(runId)) {
          seenRunIds.add(runId);
          orderedItems.push({ eventId, type: "run", runId });
        }
      }
      return run;
    }

    for (const ev of matchingEvents) {
      const payload = ev.payload as Record<string, unknown>;
      const numericId = typeof ev.id === "number" ? ev.id : parseInt(String(ev.id), 10) || 0;

      if (ev.event_type === "chat") {
        const role = payload.role as string | undefined;
        if (role === "user") {
          const { text: rawText } = extractContent(payload.content);
          const text = stripGatewayWrapper(stripAnsi(rawText));
          const ts = ev.created_at ? new Date(ev.created_at).getTime() : 0;
          orderedItems.push({
            eventId: numericId,
            type: "user",
            text,
            id: String(ev.id),
            ts,
          });
          continue;
        }

        const runId = payload.runId as string | undefined;
        const state = payload.state as string | undefined;
        const msgPayload = payload.message as Record<string, unknown> | undefined;

        if (runId && msgPayload) {
          const run = getOrCreateRun(runId, numericId);
          if (state === "delta") {
            const { thinking, text } = extractContent(msgPayload.content);
            run.chatText = stripRoutingTags(text);
            run.chatThinking = thinking;
          } else if (state === "final") {
            const { thinking, text } = extractContent(msgPayload.content);
            run.chatThinking = thinking || run.chatThinking;
            run.chatText = stripRoutingTags(text) || run.chatText;
            run.isFinal = true;
          } else if (state === "error") {
            const { text } = extractContent(msgPayload.content);
            run.chatError = text || "unknown";
            run.isFinal = true;
          }
        }
        continue;
      }

      if (ev.event_type === "agent") {
        const stream = payload.stream as string | undefined;
        const runId = payload.runId as string | undefined;
        const data = payload.data as Record<string, unknown> | undefined;
        if (!runId || !data) continue;

        const run = getOrCreateRun(runId, numericId);

        if (stream === "assistant") {
          const raw = (data.text as string) ?? (data.delta as string) ?? "";
          const text = stripRoutingTags(raw);
          if (text && text !== "HEARTBEAT_OK") {
            run.agentText = text;
          }
        } else if (stream === "thinking") {
          const text = (data.text as string) ?? (data.delta as string) ?? "";
          if (text) run.agentThinking = text;
        } else if (stream === "lifecycle") {
          const phase = (data.phase as string) ?? "";
          if (phase === "end") run.agentEnded = true;
        } else if (stream === "tool") {
          const t = parseToolEvent(data);

          if (t.toolUseId) {
            let existing = run.toolCalls.get(t.toolUseId);
            if (!existing) {
              existing = {
                id: t.toolUseId,
                name: t.toolName,
                arguments: t.args ?? {},
                argsSummary: t.args ? formatArgsSummary(t.toolName, t.args) : "",
                result: null,
                isError: false,
              };
              run.toolCalls.set(t.toolUseId, existing);
            }
            if (t.toolName && existing.name === "tool") {
              existing.name = t.toolName;
            }
            if (t.args && !existing.argsSummary) {
              existing.argsSummary = formatArgsSummary(existing.name, t.args);
            }
            if (isToolComplete(t.status, t.result)) {
              if (t.result != null) existing.result = t.result;
            }
            if (t.isError) {
              existing.isError = true;
            }
          }
        }
      }
    }

    orderedItems.sort((a, b) => a.eventId - b.eventId);

    const items: DisplayItem[] = [];
    for (const item of orderedItems) {
      if (item.type === "user") {
        items.push({ type: "user", id: item.id, text: item.text, ts: item.ts });
      } else {
        const run = runStates.get(item.runId)!;
        const isDone = run.isFinal || run.agentEnded;

        const text = run.chatText || run.agentText;
        const thinking = run.chatThinking || run.agentThinking;
        const toolCalls = Array.from(run.toolCalls.values());

        if (text || thinking || toolCalls.length > 0 || run.chatError || !isDone) {
          items.push({
            type: "assistant",
            id: `run-${item.runId}`,
            text,
            thinking: thinking || undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            isStreaming: !isDone,
            error: run.chatError
              ? { message: run.chatError, type: "error", retryCount: 1, isFinal: true }
              : undefined,
          });
        }
      }
    }

    return items;
  }, [events, sessionKey]);

  // Merge: history turns + live overlay (only in-progress items from live)
  const allItems = useMemo((): DisplayItem[] => {
    const items: DisplayItem[] = [];

    for (let i = 0; i < historyTurns.length; i++) {
      const turn = historyTurns[i];
      if (turn.role === "user") {
        items.push({ type: "user", id: `hist-user-${i}`, text: turn.text });
      } else {
        items.push({
          type: "assistant",
          id: `hist-asst-${i}`,
          text: turn.text,
          thinking: turn.thinking,
          toolCalls: turn.toolCalls,
          error: turn.error,
        });
      }
    }

    // Append live items, deduplicating against history.
    // Completed runs may not be in historyTurns yet (fetchTurns is async),
    // so we keep them visible and skip only if history already has them.
    // User messages: only show those sent AFTER the last history fetch
    // (for instant feedback). Older messages are either already in
    // historyTurns or were never delivered — either way, skip them.
    for (const item of liveItems) {
      if (item.type === "assistant" && !item.isStreaming) {
        // Skip if history already contains this content
        const textSnippet = item.text.slice(0, 80);
        const alreadyInHistory =
          textSnippet && items.some((h) => h.type === "assistant" && h.text.includes(textSnippet));
        if (alreadyInHistory) continue;
      }
      if (item.type === "user") {
        // Skip messages from before the last history fetch
        if (item.ts && item.ts < historyFetchedAt) continue;
        const text = item.text.trim();
        const alreadyInHistory = items.some((h) => h.type === "user" && h.text.includes(text));
        if (alreadyInHistory) continue;
      }
      items.push(item);
    }
    return items;
  }, [historyTurns, liveItems, historyFetchedAt]);

  const isStreaming = liveItems.some((item) => item.type === "assistant" && item.isStreaming);

  const historyToolCount = useMemo(
    () => historyTurns.reduce((n, t) => n + (t.toolCalls?.length ?? 0), 0),
    [historyTurns],
  );

  // Auto-scroll
  const lastItem = allItems[allItems.length - 1];
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allItems.length, lastItem]);

  const handleSend = useCallback(
    async (message: string) => {
      if (!sessionKey || !sessionId) return;
      try {
        await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, sessionKey, message }),
        });
      } catch {
        toast.error("Failed to send message");
      }
    },
    [sessionId, sessionKey],
  );

  const handleAbort = useCallback(async () => {
    if (!sessionKey) return;
    try {
      await fetch("/api/chat/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey }),
      });
    } catch {
      toast.error("Failed to abort");
    }
  }, [sessionKey]);

  const lastRunStart =
    runs.length > 0 && lifecycleState === "running" ? runs[runs.length - 1].startedAt : null;

  return (
    <Card className="h-full rounded-none border-0 flex flex-col gap-0 py-0">
      <CardHeader className="pt-3 pb-1 px-3 gap-0 flex-none">
        <CardTitle className="text-xs font-medium flex items-center gap-2">
          Agent
          {historyToolCount > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4">
              {historyToolCount} tools
            </Badge>
          )}
          {runs.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4">
              {runs.length} runs
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <LifecycleBanner state={lifecycleState} runStartedAt={lastRunStart} />
      <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="py-2">
            {!projectId && (
              <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                Select a project to start chatting
              </p>
            )}
            {projectId && resolving && (
              <p className="text-xs text-muted-foreground px-3 py-4 text-center">Connecting...</p>
            )}
            {error && <p className="text-xs text-destructive px-3 py-4 text-center">{error}</p>}
            {projectId && !resolving && !error && allItems.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                Send a message to start the conversation
              </p>
            )}
            {allItems.map((item) =>
              item.type === "user" ? (
                <ChatMessage
                  key={item.id}
                  message={{
                    id: item.id,
                    role: "user",
                    content: item.text,
                  }}
                />
              ) : (
                <AssistantTurn
                  key={item.id}
                  thinking={item.thinking}
                  toolCalls={item.toolCalls}
                  text={item.text}
                  isStreaming={item.isStreaming}
                  error={item.error}
                />
              ),
            )}
            <div ref={bottomRef} />
          </div>
        </div>
        <ChatInput
          onSend={handleSend}
          onAbort={handleAbort}
          isStreaming={isStreaming}
          disabled={!sessionKey || resolving}
        />
      </CardContent>
    </Card>
  );
}
