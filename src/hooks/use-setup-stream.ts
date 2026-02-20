"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Terminal } from "@xterm/xterm";

export type SetupStreamState = "idle" | "running" | "exited";

/**
 * Hook that connects to the /api/setup/stream SSE endpoint.
 * Only connects when `enabled` is true (i.e. dialog is open and terminal is ready).
 *
 * The SSE route manages the process lifecycle (auto-starts if idle, replays
 * buffered output for late-connecting clients). No client-side reset needed.
 */
export function useSetupStream(enabled: boolean) {
  const termRef = useRef<Terminal | null>(null);
  const [connected, setConnected] = useState(false);
  const [setupState, setSetupState] = useState<SetupStreamState>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [dashboardOpened, setDashboardOpened] = useState(false);

  const setTerminal = useCallback((term: Terminal | null) => {
    termRef.current = term;
  }, []);

  const sendInput = useCallback((data: string) => {
    fetch("/api/setup/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setSetupState("idle");
      setExitCode(null);
      setDashboardOpened(false);
      return;
    }

    // Pass terminal dimensions so the server-side PTY matches
    const term = termRef.current;
    const cols = term?.cols ?? 80;
    const rows = term?.rows ?? 24;
    const params = new URLSearchParams({ cols: String(cols), rows: String(rows) });
    const es = new EventSource(`/api/setup/stream?${params}`);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.data && termRef.current) {
          termRef.current.write(payload.data);
        }
      } catch { /* ignore */ }
    };

    es.addEventListener("state", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.state) setSetupState(payload.state);
        if (typeof payload.exitCode === "number") setExitCode(payload.exitCode);
      } catch { /* ignore */ }
    });

    es.addEventListener("exit", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        setSetupState("exited");
        setExitCode(payload.exitCode ?? 1);
        termRef.current?.write(
          `\r\n\x1b[90m[setup exited with code ${payload.exitCode ?? 1}]\x1b[0m\r\n`,
        );
      } catch { /* ignore */ }
    });

    es.addEventListener("openUrl", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.url) {
          window.open(payload.url, "_blank");
          setDashboardOpened(true);
        }
      } catch { /* ignore */ }
    });

    es.addEventListener("deviceApproved", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        termRef.current?.write(
          `\r\n\x1b[32m[Device ${payload.requestId} approved]\x1b[0m\r\n`,
        );
      } catch { /* ignore */ }
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, [enabled]);

  return { setTerminal, sendInput, connected, setupState, exitCode, dashboardOpened };
}
