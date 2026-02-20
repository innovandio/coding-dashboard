"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useSetupStream } from "@/hooks/use-setup-stream";
import type { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

export function SetupDialog({
  open,
  onSetupComplete,
}: {
  open: boolean;
  onSetupComplete: () => void;
}) {
  // Track container element via callback ref → state so effects re-run when it appears
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const [termReady, setTermReady] = useState(false);

  const { setTerminal, sendInput, setupState, exitCode, dashboardOpened } =
    useSetupStream(open && termReady);

  // Initialize xterm.js when the container element appears
  useEffect(() => {
    if (!open || !containerEl) return;

    let disposed = false;
    let term: Terminal | undefined;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (disposed || !containerEl) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily:
          '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
        theme: {
          background: "#0a0a0a",
          foreground: "#e4e4e7",
          cursor: "#e4e4e7",
          selectionBackground: "rgba(255, 255, 255, 0.2)",
        },
        scrollback: 5000,
        convertEol: false,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerEl);
      fitAddon.fit();

      term.onData((data) => sendInput(data));

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
      setTerminal(term);
      setTermReady(true);
    };

    init();

    return () => {
      disposed = true;
      setTerminal(null);
      setTermReady(false);
      terminalRef.current = null;
      fitAddonRef.current = null;
      term?.dispose();
    };
  }, [open, containerEl, setTerminal, sendInput]);

  // Handle resize
  useEffect(() => {
    if (!open || !containerEl || !termReady) return;

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    observer.observe(containerEl);

    return () => observer.disconnect();
  }, [open, containerEl, termReady]);

  // Auto-close 2s after the dashboard URL has been opened (post-restart),
  // or 120s after successful exit as a fallback (gateway restart + npm update is slow).
  useEffect(() => {
    if (setupState === "exited" && exitCode === 0) {
      const delay = dashboardOpened ? 2000 : 120000;
      const timer = setTimeout(onSetupComplete, delay);
      return () => clearTimeout(timer);
    }
  }, [setupState, exitCode, dashboardOpened, onSetupComplete]);

  const statusBadge =
    setupState === "running" ? (
      <Badge variant="outline" className="text-[10px]">
        Running
      </Badge>
    ) : setupState === "exited" && exitCode === 0 && dashboardOpened ? (
      <Badge
        variant="secondary"
        className="text-[10px] bg-green-900/40 text-green-400"
      >
        Complete
      </Badge>
    ) : setupState === "exited" && exitCode === 0 ? (
      <Badge variant="outline" className="text-[10px] animate-pulse">
        Restarting gateway...
      </Badge>
    ) : setupState === "exited" ? (
      <Badge variant="destructive" className="text-[10px]">
        Failed (code {exitCode})
      </Badge>
    ) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={() => {
        /* prevent accidental close */
      }}
    >
      <DialogContent
        className="sm:max-w-2xl h-[480px] flex flex-col gap-3 p-4"
        showCloseButton={setupState === "exited"}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex-none">
          <DialogTitle className="text-sm flex items-center gap-2">
            OpenClaw Setup
            {statusBadge}
          </DialogTitle>
          <DialogDescription className="text-xs">
            The gateway needs initial configuration. Complete the setup wizard
            below.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 rounded border border-border overflow-hidden">
          <div
            ref={useCallback(
              (node: HTMLDivElement | null) => setContainerEl(node),
              [],
            )}
            className="h-full w-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
