"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { BusEvent } from "@/lib/event-bus";

export function useEventStream(
  projectId: string | null,
  sessionId: string | null,
  onEvent: (ev: BusEvent) => void
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (sessionId) params.set("session_id", sessionId);

    const url = `/api/events/stream?${params.toString()}`;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const ev: BusEvent = JSON.parse(e.data);
        onEventRef.current(ev);
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [projectId, sessionId]);

  return { connected };
}

export function useEventStreamAccumulator(
  projectId: string | null,
  sessionId: string | null,
  maxEvents = 200
) {
  const [events, setEvents] = useState<BusEvent[]>([]);

  const handleEvent = useCallback(
    (ev: BusEvent) => {
      setEvents((prev) => {
        const next = [...prev, ev];
        if (next.length > maxEvents) return next.slice(-maxEvents);
        return next;
      });
    },
    [maxEvents]
  );

  const { connected } = useEventStream(projectId, sessionId, handleEvent);

  return { events, connected };
}
