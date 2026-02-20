"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Terminal } from "@xterm/xterm";

/**
 * Hook that connects to the /api/pty/stream SSE endpoint and writes
 * incoming PTY data to an xterm.js Terminal instance.
 *
 * Supports multiple concurrent processes (distinguished by runId).
 * All processes for the given projectId are rendered into the same terminal.
 */
export function usePtyStream(projectId: string | null) {
  const termRef = useRef<Terminal | null>(null);
  const [connected, setConnected] = useState(false);
  const [hasActivity, setHasActivity] = useState(false);
  const [activeRuns, setActiveRuns] = useState<Set<string>>(new Set());

  const setTerminal = useCallback((term: Terminal | null) => {
    termRef.current = term;
  }, []);

  useEffect(() => {
    if (!projectId) {
      setConnected(false);
      setHasActivity(false);
      setActiveRuns(new Set());
      return;
    }

    const runs = new Set<string>();
    const params = new URLSearchParams({ projectId });
    const es = new EventSource(`/api/pty/stream?${params}`);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    // Default "message" events carry pty.data payloads
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.data && termRef.current) {
          termRef.current.write(payload.data);
          setHasActivity(true);
        }
      } catch { /* ignore parse errors */ }
    };

    es.addEventListener("started", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.runId) {
          runs.add(payload.runId);
          setActiveRuns(new Set(runs));
        }
      } catch { /* ignore */ }
      setHasActivity(true);
    });

    es.addEventListener("exited", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.runId) {
          runs.delete(payload.runId);
          setActiveRuns(new Set(runs));
        }
        termRef.current?.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
      } catch { /* ignore */ }
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, [projectId]);

  return { setTerminal, connected, hasActivity, activeRuns };
}
