"use client";

import { useRef, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StreamItem } from "./stream-item";
import type { BusEvent } from "@/lib/event-bus";

export function LiveStream({ events }: { events: BusEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const agentEvents = useMemo(
    () => events.filter((e) => e.event_type === "agent" || e.source === "gateway"),
    [events]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentEvents.length]);

  return (
    <Card className="h-full rounded-none border-0">
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs font-medium flex items-center gap-2">
          Live Stream
          <Badge variant="secondary" className="text-[10px] h-4">
            {agentEvents.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[calc(100%-2rem)]">
          {agentEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-4 text-center">
              Waiting for events...
            </p>
          ) : (
            <>
              {agentEvents.map((ev) => (
                <StreamItem key={ev.id} event={ev} />
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
