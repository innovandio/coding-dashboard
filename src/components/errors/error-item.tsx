"use client";

import { useState } from "react";
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

function getSeverity(ev: BusEvent): "error" | "warn" {
  const p = ev.payload;
  if (
    ev.event_type === "error" ||
    (typeof p.level === "string" && p.level === "error") ||
    typeof p.error === "string"
  ) {
    return "error";
  }
  return "warn";
}

function getMessage(ev: BusEvent): string {
  const p = ev.payload;
  if (typeof p.error === "string") return stripAnsi(p.error);
  if (typeof p.message === "string") return stripAnsi(p.message);
  if (typeof p.text === "string") return stripAnsi(p.text);
  return ev.event_type;
}

export function ErrorItem({ event }: { event: BusEvent }) {
  const [expanded, setExpanded] = useState(false);
  const severity = getSeverity(event);

  return (
    <div
      className="px-2 py-1.5 border-b border-border/30 hover:bg-muted/30 cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <span
          className={`h-2 w-2 rounded-full shrink-0 mt-1 ${
            severity === "error" ? "bg-red-500" : "bg-yellow-500"
          }`}
        />
        <span className="text-[10px] text-muted-foreground font-mono shrink-0">
          {formatTime(event.created_at)}
        </span>
        <span className="text-xs text-foreground truncate">
          {getMessage(event)}
        </span>
      </div>
      {expanded && (
        <div className="mt-2 ml-6 p-2 bg-muted/50 rounded">
          <JsonViewer data={event.payload} />
        </div>
      )}
    </div>
  );
}
