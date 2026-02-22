"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Terminal } from "@xterm/xterm";

export interface RunInfo {
  runId: string;
  pid?: number;
  active: boolean;
  index: number;
  label?: string;
  command?: string;
  title?: string;
}

/**
 * Hook that connects to the /api/pty/stream SSE endpoint and writes
 * incoming PTY data to an xterm.js Terminal instance.
 *
 * Supports multiple concurrent processes (distinguished by runId).
 * Each process gets its own buffer; the user can switch between them.
 *
 * Also provides sendInput() and killProcess() for interactive control.
 */
export function usePtyStream(projectId: string | null) {
  const termRef = useRef<Terminal | null>(null);
  const pendingWrites = useRef<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [hasActivity, setHasActivity] = useState(false);
  const [allRuns, setAllRuns] = useState<RunInfo[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Mutable refs so SSE callbacks always see latest values
  const runBuffersRef = useRef<Map<string, string>>(new Map());
  const selectedRunIdRef = useRef<string | null>(null);
  const runCounterRef = useRef(0);

  // Keep ref in sync with state
  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

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
  const sendInput = useCallback(async (runId: string, data: string) => {
    try {
      await fetch("/api/pty/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, data }),
      });
    } catch {
      /* best effort */
    }
  }, []);

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

  /** Switch the visible terminal to a different run's buffer. */
  const selectRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    selectedRunIdRef.current = runId;
    const term = termRef.current;
    if (!term) return;
    term.reset();
    const buffer = runBuffersRef.current.get(runId);
    if (buffer) {
      term.write(buffer);
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setConnected(false);
      setHasActivity(false);
      setAllRuns([]);
      setSelectedRunId(null);
      selectedRunIdRef.current = null;
      runBuffersRef.current = new Map();
      runCounterRef.current = 0;
      pendingWrites.current = [];
      return;
    }

    const runsMap = new Map<string, RunInfo>();
    runBuffersRef.current = new Map();
    runCounterRef.current = 0;

    const params = new URLSearchParams({ projectId });
    const es = new EventSource(`/api/pty/stream?${params}`);

    // Detect Claude Code's thinking spinner (color 174 = salmon + spinner
    // glyph) to drive the thinking indicator. Resets after 1s of no frames.
    // The spinner cycles through: ✻ ✶ * ✢ — match color 174 followed by
    // one of these characters to avoid false positives on startup output.
    const SPINNER_RE = /\x1b\[38;5;174m[✻✶*✢·]/;
    let activityTimer: ReturnType<typeof setTimeout> | null = null;
    // Suppress spinner detection during the initial buffer replay that
    // happens right after SSE connect — replayed data from a previous
    // session may contain stale spinner frames.
    let replayDone = false;

    es.onopen = () => {
      setConnected(true);
      setTimeout(() => {
        replayDone = true;
      }, 500);
    };
    es.onerror = () => setConnected(false);

    // Parse OSC title sequences: \x1b]0;title\x07 or \x1b]2;title\x07
    const OSC_TITLE_RE = /\x1b\](?:0|2);([^\x07\x1b]*?)(?:\x07|\x1b\\)/;

    // Default "message" events carry pty.data payloads
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.data && payload.runId) {
          // Buffer data per run
          const existing = runBuffersRef.current.get(payload.runId) ?? "";
          runBuffersRef.current.set(payload.runId, existing + payload.data);

          // Only write to terminal if this is the selected run
          if (selectedRunIdRef.current === payload.runId) {
            writeToTerminal(payload.data);
          }

          // Extract window title from OSC sequences
          const titleMatch = payload.data.match(OSC_TITLE_RE);
          if (titleMatch) {
            const info = runsMap.get(payload.runId);
            if (info && info.title !== titleMatch[1]) {
              runsMap.set(payload.runId, { ...info, title: titleMatch[1] });
              setAllRuns(Array.from(runsMap.values()));
            }
          }

          if (replayDone && SPINNER_RE.test(payload.data)) {
            setHasActivity(true);
            if (activityTimer) clearTimeout(activityTimer);
            activityTimer = setTimeout(() => setHasActivity(false), 1000);
          }
        }
      } catch {
        /* ignore parse errors */
      }
    };

    es.addEventListener("started", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.runId) {
          runCounterRef.current++;
          const info: RunInfo = {
            runId: payload.runId,
            pid: payload.pid,
            active: true,
            index: runCounterRef.current,
            label: payload.label,
            command: payload.command,
          };
          runsMap.set(payload.runId, info);
          if (!runBuffersRef.current.has(payload.runId)) {
            runBuffersRef.current.set(payload.runId, "");
          }
          setAllRuns(Array.from(runsMap.values()));

          // Auto-select new runs and clear terminal for fresh output
          setSelectedRunId(payload.runId);
          selectedRunIdRef.current = payload.runId;
          const term = termRef.current;
          if (term) {
            term.reset();
          }
        }
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("exited", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.runId) {
          const info = runsMap.get(payload.runId);
          if (info) {
            runsMap.set(payload.runId, { ...info, active: false });
            setAllRuns(Array.from(runsMap.values()));
          }
          // Append exit message to run's buffer
          const exitMsg = "\r\n\x1b[90m[process exited]\x1b[0m\r\n";
          const existing = runBuffersRef.current.get(payload.runId) ?? "";
          runBuffersRef.current.set(payload.runId, existing + exitMsg);
          if (selectedRunIdRef.current === payload.runId) {
            writeToTerminal(exitMsg);
          }
        }
      } catch {
        /* ignore */
      }
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

  return {
    setTerminal,
    connected,
    hasActivity,
    allRuns,
    selectedRunId,
    selectRun,
    sendInput,
    killProcess,
  };
}
