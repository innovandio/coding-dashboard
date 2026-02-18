"use client";

import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ConnectionDot } from "@/components/shared/connection-dot";
import { useTmuxOutput } from "@/hooks/use-tmux-stream";
import { Settings } from "lucide-react";
import { AnsiUp } from "ansi_up";

const ansi = new AnsiUp();
ansi.use_classes = true;

const DEFAULT_PING_MESSAGE = "Claude Code finished its work. Please check what is the next step";

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

function getPingBackSettings(projectId: string): { enabled: boolean; message: string } {
  try {
    const raw = localStorage.getItem(`pingback:${projectId}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { enabled: false, message: DEFAULT_PING_MESSAGE };
}

function savePingBackSettings(projectId: string, settings: { enabled: boolean; message: string }) {
  localStorage.setItem(`pingback:${projectId}`, JSON.stringify(settings));
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

async function sendPingBack(projectId: string, message: string) {
  try {
    // Get or create chat session for this project
    const sessionRes = await fetch("/api/chat/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    if (!sessionRes.ok) return;
    const { sessionId, sessionKey } = await sessionRes.json();

    // Send the ping-back message
    await fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, sessionKey, message }),
    });
  } catch (err) {
    console.error("[ping-back] Failed to send:", err);
  }
}

export function TmuxPanel({ projectId, onThinkingChange }: { projectId: string | null; onThinkingChange?: (thinking: boolean) => void }) {
  const sessionName = useMemo(
    () => (projectId ? `dash-${projectId.replace(/[^a-zA-Z0-9-]/g, "-")}` : null),
    [projectId]
  );
  const { output, connected, thinking } = useTmuxOutput(sessionName);
  const prevThinking = useRef(thinking);

  // Ping-back settings (per project)
  const [pingBackEnabled, setPingBackEnabled] = useState(false);
  const [pingBackMessage, setPingBackMessage] = useState(DEFAULT_PING_MESSAGE);
  const [draftMessage, setDraftMessage] = useState(DEFAULT_PING_MESSAGE);

  // Load settings when project changes
  useEffect(() => {
    if (!projectId) return;
    const settings = getPingBackSettings(projectId);
    setPingBackEnabled(settings.enabled);
    setPingBackMessage(settings.message);
    setDraftMessage(settings.message);
  }, [projectId]);

  // Detect thinking→idle transition for ping-back
  useEffect(() => {
    if (prevThinking.current !== thinking) {
      const wasThinking = prevThinking.current;
      prevThinking.current = thinking;
      onThinkingChange?.(thinking);

      // Fire ping-back when thinking stops
      if (wasThinking && !thinking && pingBackEnabled && projectId) {
        sendPingBack(projectId, pingBackMessage);
      }
    }
  }, [thinking, onThinkingChange, pingBackEnabled, pingBackMessage, projectId]);

  const handlePingBackToggle = useCallback((checked: boolean) => {
    setPingBackEnabled(checked);
    if (projectId) {
      savePingBackSettings(projectId, { enabled: checked, message: pingBackMessage });
    }
  }, [projectId, pingBackMessage]);

  const handleSaveMessage = useCallback(() => {
    setPingBackMessage(draftMessage);
    if (projectId) {
      savePingBackSettings(projectId, { enabled: pingBackEnabled, message: draftMessage });
    }
  }, [projectId, pingBackEnabled, draftMessage]);

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
          <div className="ml-auto flex items-center gap-2">
            {connected && (
              <span className="inline-flex items-center gap-1.5">
                <Switch
                  checked={pingBackEnabled}
                  onCheckedChange={handlePingBackToggle}
                  className="scale-90"
                />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  Ping back
                </span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon-xs" className="h-4 w-4">
                      <Settings className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80">
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Ping-back message</Label>
                        <p className="text-[10px] text-muted-foreground">
                          Sent to the Agent when Claude Code stops thinking
                        </p>
                      </div>
                      <Input
                        value={draftMessage}
                        onChange={(e) => setDraftMessage(e.target.value)}
                        className="text-xs h-8"
                        placeholder={DEFAULT_PING_MESSAGE}
                      />
                      <Button
                        size="sm"
                        className="w-full h-7 text-xs"
                        onClick={handleSaveMessage}
                        disabled={draftMessage === pingBackMessage}
                      >
                        Save
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </span>
            )}
            <ConnectionDot
              status={connected ? "connected" : sessionName ? "connecting" : "disconnected"}
              label={connected ? (thinking ? "Thinking" : "Streaming") : sessionName ? "Connecting..." : "No session"}
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
