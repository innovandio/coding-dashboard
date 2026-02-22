"use client";

import { useEffect, useRef, useState } from "react";
import type { BusEvent } from "@/lib/event-bus";

export function useEventStream(
  projectId: string | null,
  sessionId: string | null,
  onEvent: (ev: BusEvent) => void,
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
