import { useMemo } from "react";
import { formatArgsSummary, truncate } from "@/lib/format-args";
import { parseToolEvent, isToolComplete } from "@/lib/parse-tool-event";
import type { BusEvent } from "@/lib/event-bus";

// --- Types ---

export interface ToolCallItem {
  kind: "tool";
  id: string;
  name: string;
  argsSummary: string;
  status: "running" | "done";
  startedAt: number;
  result: unknown | null;
}

export interface AssistantTextItem {
  kind: "assistant";
  text: string;
  startedAt: number;
}

export interface ThinkingItem {
  kind: "thinking";
  text: string;
  startedAt: number;
}

export type ActivityItem = ToolCallItem | AssistantTextItem | ThinkingItem;

export interface ActivityRun {
  runId: string;
  startedAt: number;
  endedAt: number | null;
  state: "running" | "done" | "error";
  items: ActivityItem[];
}

export interface AgentActivityState {
  lifecycleState: "idle" | "running" | "error";
  runs: ActivityRun[];
}

// --- Helpers ---

function parseTimestamp(iso: string): number {
  try {
    return new Date(iso).getTime();
  } catch {
    return Date.now();
  }
}

function extractText(data: Record<string, unknown>): string {
  return (data.text as string) ?? (data.delta as string) ?? "";
}

/** Check if an event looks like an agent stream event (has stream + runId in payload) */
function isAgentStreamEvent(ev: BusEvent): boolean {
  if (ev.event_type === "agent") return true;
  const p = ev.payload;
  return typeof p.stream === "string" && typeof p.runId === "string";
}

// --- Hook ---

export function useAgentActivity(events: BusEvent[]): AgentActivityState {
  return useMemo(() => {
    const runMap = new Map<string, ActivityRun>();
    const toolMap = new Map<string, ToolCallItem>();
    let toolSeq = 0;

    for (const ev of events) {
      if (!isAgentStreamEvent(ev)) continue;

      const payload = ev.payload as Record<string, unknown>;
      const stream = payload.stream as string | undefined;
      const runId = payload.runId as string | undefined;
      const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
      if (!runId) continue;

      const ts = parseTimestamp(ev.created_at);

      let run = runMap.get(runId);
      if (!run) {
        run = {
          runId,
          startedAt: ts,
          endedAt: null,
          state: "running",
          items: [],
        };
        runMap.set(runId, run);
      }

      switch (stream) {
        case "lifecycle": {
          const phase = (data.phase ?? data.event ?? data.state) as string | undefined;
          if (phase === "start" || phase === "started") {
            run.startedAt = ts;
            run.state = "running";
          } else if (
            phase === "end" ||
            phase === "ended" ||
            phase === "done" ||
            phase === "complete"
          ) {
            run.endedAt = ts;
            run.state = "done";
          } else if (phase === "error" || phase === "failed") {
            run.endedAt = ts;
            run.state = "error";
          }
          break;
        }

        case "tool": {
          const t = parseToolEvent(data);
          const text = extractText(data);
          const effectiveId = t.toolUseId || `tool-${++toolSeq}`;
          const mapKey = `${runId}:${effectiveId}`;
          let existing = toolMap.get(mapKey);
          if (!existing) {
            existing = {
              kind: "tool",
              id: effectiveId,
              name: t.toolName,
              argsSummary: t.args
                ? formatArgsSummary(t.toolName, t.args)
                : text
                  ? truncate(text, 80)
                  : "",
              status: "running",
              startedAt: ts,
              result: null,
            };
            toolMap.set(mapKey, existing);
            run.items.push(existing);
          }
          if (t.toolName && existing.name === "tool") {
            existing.name = t.toolName;
          }
          if (t.args && !existing.argsSummary) {
            existing.argsSummary = formatArgsSummary(existing.name, t.args);
          }
          if (isToolComplete(t.status, t.result)) {
            existing.status = "done";
          }
          if (t.result != null) {
            existing.result = t.result;
          }
          break;
        }

        case "assistant": {
          const text = extractText(data);
          if (text && text !== "HEARTBEAT_OK") {
            const lastItem = run.items[run.items.length - 1];
            if (lastItem && lastItem.kind === "assistant") {
              lastItem.text = text;
            } else {
              run.items.push({ kind: "assistant", text, startedAt: ts });
            }
          }
          break;
        }

        case "thinking": {
          const text = extractText(data);
          if (text) {
            const lastItem = run.items[run.items.length - 1];
            if (lastItem && lastItem.kind === "thinking") {
              lastItem.text = text;
            } else {
              run.items.push({ kind: "thinking", text, startedAt: ts });
            }
          }
          break;
        }

        case "exec":
        case "process":
        case "result":
        case "system": {
          const text = extractText(data);
          const lastTool = [...run.items]
            .reverse()
            .find((item): item is ToolCallItem => item.kind === "tool");
          if (lastTool && text) {
            if (lastTool.result == null) {
              lastTool.result = text;
            }
          }
          break;
        }
      }
    }

    if (runMap.size === 0) {
      return { lifecycleState: "idle", runs: [] };
    }

    const runs = Array.from(runMap.values());
    runs.sort((a, b) => a.startedAt - b.startedAt);

    let lifecycleState: "idle" | "running" | "error" = "idle";
    if (runs.length > 0) {
      const lastRun = runs[runs.length - 1];
      if (lastRun.state === "running") {
        lifecycleState = "running";
      } else if (lastRun.state === "error") {
        lifecycleState = "error";
      }
    }

    return { lifecycleState, runs };
  }, [events]);
}
