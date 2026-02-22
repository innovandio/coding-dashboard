"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { JsonViewer } from "@/components/shared/json-viewer";
import { stripAnsi } from "@/lib/utils";
import type { BusEvent } from "@/lib/event-bus";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

function getSummary(ev: BusEvent): string {
  const p = ev.payload;
  if (typeof p.message === "string") return stripAnsi(p.message);
  if (typeof p.text === "string") return stripAnsi(p.text);
  if (typeof p.summary === "string") return stripAnsi(p.summary);
  if (typeof p.content === "string") return stripAnsi(p.content).slice(0, 120);
  if (typeof p.tool === "string") return `tool: ${p.tool}`;
  if (typeof p.method === "string") return `method: ${p.method}`;
  return ev.event_type;
}

export function StreamItem({ event }: { event: BusEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="px-2 py-1.5 border-b border-border/50 hover:bg-muted/30 cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <span className="text-[10px] text-muted-foreground font-mono shrink-0 pt-0.5">
          {formatTime(event.created_at)}
        </span>
        <Badge variant="outline" className="text-[10px] h-4 shrink-0">
          {event.event_type}
        </Badge>
        <span className="text-xs text-foreground truncate">
          {getSummary(event)}
        </span>
      </div>
      {expanded && (
        <div className="mt-2 ml-14 p-2 bg-muted/50 rounded">
          <JsonViewer data={event.payload} />
        </div>
      )}
    </div>
  );
}
