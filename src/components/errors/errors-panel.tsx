"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ErrorItem } from "./error-item";
import type { BusEvent } from "@/lib/event-bus";

function isErrorEvent(ev: BusEvent): boolean {
  if (ev.event_type === "error" || ev.event_type === "failure") return true;
  const p = ev.payload;
  if (typeof p.level === "string" && (p.level === "error" || p.level === "warn")) return true;
  if (typeof p.error === "string") return true;
  if (typeof p.ok === "boolean" && !p.ok) return true;
  return false;
}

export function ErrorsPanel({ events }: { events: BusEvent[] }) {
  const errorEvents = useMemo(() => events.filter(isErrorEvent), [events]);

  return (
    <Card className="h-full rounded-none border-0">
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs font-medium flex items-center gap-2">
          Errors
          {errorEvents.length > 0 && (
            <Badge variant="destructive" className="text-[10px] h-4">
              {errorEvents.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[calc(100%-2rem)]">
          {errorEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-4 text-center">No errors</p>
          ) : (
            errorEvents.map((ev) => <ErrorItem key={ev.id} event={ev} />)
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
