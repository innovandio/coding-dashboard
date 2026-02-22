"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Terminal } from "@xterm/xterm";

/**
 * Hook that connects to the /api/pty/stream SSE endpoint and writes
 * incoming PTY data to an xterm.js Terminal instance.
 *
 * Supports multiple concurrent processes (distinguished by runId).
 * All processes for the given projectId are rendered into the same terminal.
 *
 * Also provides sendInput() and killProcess() for interactive control.
 */
export function usePtyStream(projectId: string | null) {
  const termRef = useRef<Terminal | null>(null);
  const pendingWrites = useRef<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [hasActivity, setHasActivity] = useState(false);
  const [activeRuns, setActiveRuns] = useState<Set<string>>(new Set());

  const setTerminal = useCallback((term: Terminal | null) => {
    termRef.current = term;
    // Flush any data that arrived before the terminal was ready
    if (term && pendingWrites.current.length > 0) {
      for (const data of pendingWrites.current) {
        term.write(data);
      }
      pendingWrites.current = [];
    }
  }, []);

  /** Write to terminal, buffering if it isn't ready yet. */
  const writeToTerminal = useCallback((data: string) => {
    if (termRef.current) {
      termRef.current.write(data);
    } else {
      pendingWrites.current.push(data);
    }
  }, []);

  /** Send raw input data to a specific PTY process. */
  const sendInput = useCallback(
    async (runId: string, data: string) => {
      try {
        await fetch("/api/pty/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, data }),
        });
      } catch {
        /* best effort */
      }
    },
    [],
  );

  /** Send input to all active PTY processes. */
  const sendInputToAll = useCallback(
    async (data: string) => {
      const runs = Array.from(activeRuns);
      await Promise.all(runs.map((runId) => sendInput(runId, data)));
    },
    [activeRuns, sendInput],
  );

  /** Kill a specific PTY process. */
  const killProcess = useCallback(async (runId: string) => {
    try {
      await fetch("/api/pty/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
    } catch {
      /* best effort */
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setConnected(false);
      setHasActivity(false);
      setActiveRuns(new Set());
      pendingWrites.current = [];
      return;
    }

    const runs = new Set<string>();
    const params = new URLSearchParams({ projectId });
    const es = new EventSource(`/api/pty/stream?${params}`);

    // Detect Claude Code's thinking spinner (color 174 = salmon) to
    // drive the thinking indicator. Resets after 3s of no spinner frames.
    const SPINNER_COLOR = "\x1b[38;5;174m";
    let activityTimer: ReturnType<typeof setTimeout> | null = null;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    // Default "message" events carry pty.data payloads
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.data) {
          writeToTerminal(payload.data);
          if (payload.data.includes(SPINNER_COLOR)) {
            setHasActivity(true);
            if (activityTimer) clearTimeout(activityTimer);
            activityTimer = setTimeout(() => setHasActivity(false), 1000);
          }
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
    });

    es.addEventListener("exited", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.runId) {
          runs.delete(payload.runId);
          setActiveRuns(new Set(runs));
        }
        writeToTerminal("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
      } catch { /* ignore */ }
      setHasActivity(false);
      if (activityTimer) clearTimeout(activityTimer);
    });

    return () => {
      es.close();
      setConnected(false);
      if (activityTimer) clearTimeout(activityTimer);
      pendingWrites.current = [];
    };
  }, [projectId, writeToTerminal]);

  return { setTerminal, connected, hasActivity, activeRuns, sendInput, sendInputToAll, killProcess };
}
