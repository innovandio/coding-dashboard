"use client";

import { useEffect, useState, useRef } from "react";
import type { TmuxSession, TmuxOutputEvent } from "@/lib/tmux-scanner";

export function useTmuxSessions() {
  const [sessions, setSessions] = useState<TmuxSession[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/tmux/sessions");
        if (res.ok && !cancelled) {
          const data: TmuxSession[] = await res.json();
          setSessions(data);
        }
      } catch {
        // ignore fetch errors
      }
    }

    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return sessions;
}

export function useTmuxOutput(sessionName: string | null) {
  const [output, setOutput] = useState("");
  const [cursor, setCursor] = useState<{ x: number; y: number; paneHeight: number }>({ x: 0, y: 0, paneHeight: 0 });
  const [connected, setConnected] = useState(false);
  const sessionRef = useRef(sessionName);
  sessionRef.current = sessionName;

  useEffect(() => {
    if (!sessionName) {
      setOutput("");
      setCursor({ x: 0, y: 0, paneHeight: 0 });
      setConnected(false);
      return;
    }

    const params = new URLSearchParams({ session: sessionName });
    const url = `/api/tmux/stream?${params.toString()}`;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const ev: TmuxOutputEvent = JSON.parse(e.data);
        setOutput(ev.output);
        setCursor({ x: ev.cursorX, y: ev.cursorY, paneHeight: ev.paneHeight });
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [sessionName]);

  return { output, cursor, connected };
}
