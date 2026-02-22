"use client";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Status = "connected" | "connecting" | "disconnected" | "reconnecting" | "authenticating";

const colors: Record<Status, string> = {
  connected: "bg-green-500",
  connecting: "bg-yellow-500 animate-pulse",
  authenticating: "bg-yellow-500 animate-pulse",
  reconnecting: "bg-muted-foreground/50",
  disconnected: "bg-muted-foreground/50",
};

const labels: Record<Status, string> = {
  connected: "Connected",
  connecting: "Connecting...",
  authenticating: "Authenticating...",
  reconnecting: "No Gateway",
  disconnected: "No Gateway",
};

export function ConnectionDot({ status, label }: { status: Status; label?: string }) {
  const displayLabel = label ?? labels[status] ?? status;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5" role="status" aria-label={`Connection status: ${displayLabel}`}>
          <span
            aria-hidden="true"
            className={cn("h-2.5 w-2.5 rounded-full", colors[status] ?? colors.disconnected)}
          />
          <span className="text-xs text-muted-foreground">
            {displayLabel}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{displayLabel}</p>
      </TooltipContent>
    </Tooltip>
  );
}
