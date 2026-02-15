"use client";

import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConnectionDot } from "@/components/shared/connection-dot";
import { useTmuxOutput } from "@/hooks/use-tmux-stream";
import { AnsiUp } from "ansi_up";

const ansi = new AnsiUp();
ansi.use_classes = true;

// ansi_up ignores SGR 7 (reverse video), but TUI apps like Claude Code use it
// to draw their cursor. Simulate it by swapping fg/bg colors.
function simulateReverseVideo(text: string): string {
  return text
    .replace(/\x1b\[7m/g, "\x1b[7m\x1b[38;2;30;30;30m\x1b[48;2;204;204;204m")
    .replace(/\x1b\[27m/g, "\x1b[27m\x1b[39m\x1b[49m");
}

// Map browser key events to tmux send-keys arguments
const SPECIAL_KEYS: Record<string, string> = {
  Enter: "Enter",
  Backspace: "BSpace",
  Tab: "Tab",
  Escape: "Escape",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PPage",
  PageDown: "NPage",
  Delete: "DC",
  Insert: "IC",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
};

function sendKeys(session: string, keys: string, literal: boolean) {
  fetch("/api/tmux/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, keys, literal }),
  }).catch(() => {});
}

function sendResize(session: string, cols: number, rows: number) {
  fetch("/api/tmux/resize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, cols, rows }),
  }).catch(() => {});
}

const MEASURE_CHARS = 50;

function measureCharSize(element: HTMLElement): { charWidth: number; lineHeight: number } {
  const span = document.createElement("span");
  span.style.visibility = "hidden";
  span.style.position = "absolute";
  span.style.whiteSpace = "pre";
  span.textContent = "X".repeat(MEASURE_CHARS);
  element.appendChild(span);
  const rect = span.getBoundingClientRect();
  element.removeChild(span);
  return { charWidth: rect.width / MEASURE_CHARS, lineHeight: rect.height };
}

export function TmuxPanel({ projectId }: { projectId: string | null }) {
  const sessionName = useMemo(
    () => (projectId ? `dash-${projectId.replace(/[^a-zA-Z0-9-]/g, "-")}` : null),
    [projectId]
  );
  const { output, connected } = useTmuxOutput(sessionName);
  const preRef = useRef<HTMLPreElement>(null);
  const [focused, setFocused] = useState(false);
  const lastSizeRef = useRef<string>("");

  const html = useMemo(
    () => (output ? ansi.ansi_to_html(simulateReverseVideo(output)) : ""),
    [output]
  );

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [html]);

  // Measure character size and sync tmux window size to panel dimensions
  useEffect(() => {
    if (!sessionName || !preRef.current) return;

    const el = preRef.current;

    const syncSize = () => {
      const measured = measureCharSize(el);
      if (!measured.charWidth || !measured.lineHeight) return;

      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const cols = Math.floor((el.clientWidth - padX) / measured.charWidth);
      const rows = Math.floor((el.clientHeight - padY) / measured.lineHeight);

      if (cols < 1 || rows < 1) return;

      const key = `${cols}x${rows}`;
      if (key === lastSizeRef.current) return;
      lastSizeRef.current = key;

      sendResize(sessionName, cols, rows);
    };

    const observer = new ResizeObserver(syncSize);
    observer.observe(el);
    // Initial sync
    syncSize();

    return () => observer.disconnect();
  }, [sessionName]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!sessionName) return;

      // Ctrl+key combos
      if (e.ctrlKey && e.key.length === 1) {
        e.preventDefault();
        sendKeys(sessionName, `C-${e.key}`, false);
        return;
      }

      // Alt/Meta+key combos
      if (e.altKey && e.key.length === 1) {
        e.preventDefault();
        sendKeys(sessionName, `M-${e.key}`, false);
        return;
      }

      // Special keys
      const tmuxKey = SPECIAL_KEYS[e.key];
      if (tmuxKey) {
        e.preventDefault();
        sendKeys(sessionName, tmuxKey, false);
        return;
      }

      // Regular printable characters (single char, no modifier)
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        sendKeys(sessionName, e.key, true);
      }
    },
    [sessionName]
  );

  return (
    <Card className="h-full rounded-none border-0 flex flex-col gap-0 py-0">
      <CardHeader className="pt-3 pb-1 px-3 gap-0 flex-none">
        <CardTitle className="text-xs font-medium flex items-center gap-2">
          Terminal
          {sessionName && (
            <Badge variant="secondary" className="text-[10px] h-4">
              {sessionName}
            </Badge>
          )}
          <div className="ml-auto">
            <ConnectionDot
              status={connected ? "connected" : sessionName ? "connecting" : "disconnected"}
              label={connected ? "Streaming" : sessionName ? "Connecting..." : "No session"}
            />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto min-h-0">
          {!sessionName && (
            <p className="text-xs text-muted-foreground px-3 py-4 text-center">
              No project selected
            </p>
          )}
          {sessionName && (
            <pre
              ref={preRef}
              tabIndex={0}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={{ fontFamily: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace' }}
              className={`px-3 py-2 text-xs leading-tight whitespace-pre h-full overflow-y-auto overflow-x-hidden outline-none cursor-text ${
                focused ? "ring-1 ring-ring" : ""
              }`}
              dangerouslySetInnerHTML={{ __html: html || "Waiting for output..." }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
