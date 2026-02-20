"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ConnectionDot } from "@/components/shared/connection-dot";
import { usePtyStream } from "@/hooks/use-pty-stream";
import { Settings } from "lucide-react";
import type { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const DEFAULT_PING_MESSAGE = "Claude Code finished its work. Please check what is the next step";

async function fetchPingBackSettings(projectId: string): Promise<{ enabled: boolean; message: string }> {
  try {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) return { enabled: false, message: DEFAULT_PING_MESSAGE };
    const project = await res.json();
    const meta = project.meta ?? {};
    return {
      enabled: meta.pingback_enabled ?? false,
      message: meta.pingback_message ?? DEFAULT_PING_MESSAGE,
    };
  } catch {
    return { enabled: false, message: DEFAULT_PING_MESSAGE };
  }
}

function savePingBackSettings(projectId: string, settings: { enabled: boolean; message: string }) {
  fetch(`/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meta: { pingback_enabled: settings.enabled, pingback_message: settings.message } }),
  }).catch(() => {});
}

async function sendPingBack(projectId: string, message: string) {
  try {
    const sessionRes = await fetch("/api/chat/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    if (!sessionRes.ok) return;
    const { sessionId, sessionKey } = await sessionRes.json();
    await fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, sessionKey, message }),
    });
  } catch (err) {
    console.error("[ping-back] Failed to send:", err);
  }
}

export function PtyPanel({
  projectId,
  onThinkingChange,
}: {
  projectId: string | null;
  onThinkingChange?: (thinking: boolean) => void;
}) {
  const { setTerminal, connected, hasActivity, activeRuns } = usePtyStream(projectId);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);

  // Ping-back settings (per project)
  const [pingBackEnabled, setPingBackEnabled] = useState(false);
  const [pingBackMessage, setPingBackMessage] = useState(DEFAULT_PING_MESSAGE);
  const [draftMessage, setDraftMessage] = useState(DEFAULT_PING_MESSAGE);

  // Load settings from database when project changes
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchPingBackSettings(projectId).then((settings) => {
      if (cancelled) return;
      setPingBackEnabled(settings.enabled);
      setPingBackMessage(settings.message);
      setDraftMessage(settings.message);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  // Notify parent about thinking/activity state
  useEffect(() => {
    onThinkingChange?.(hasActivity);
  }, [hasActivity, onThinkingChange]);

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

  // Initialize xterm.js terminal
  useEffect(() => {
    if (!containerRef.current || !projectId) return;

    let term: Terminal;
    let fitAddon: import("@xterm/addon-fit").FitAddon;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
        theme: {
          background: "#0a0a0a",
          foreground: "#e4e4e7",
          cursor: "#e4e4e7",
          selectionBackground: "rgba(255, 255, 255, 0.2)",
        },
        scrollback: 10000,
        convertEol: false,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      if (containerRef.current) {
        term.open(containerRef.current);
        fitAddon.fit();
      }

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
      setTerminal(term);
    };

    init();

    return () => {
      setTerminal(null);
      terminalRef.current = null;
      fitAddonRef.current = null;
      term?.dispose();
    };
  }, [projectId, setTerminal]);

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [projectId]);

  return (
    <Card className="h-full rounded-none border-0 flex flex-col gap-0 py-0">
      <CardHeader className="pt-3 pb-1 px-3 gap-0 flex-none">
        <CardTitle className="text-xs font-medium flex items-center gap-2">
          Terminal
          {projectId && (
            <Badge variant="secondary" className="text-[10px] h-4">
              {projectId}
            </Badge>
          )}
          {activeRuns.size > 0 && (
            <Badge variant="outline" className="text-[10px] h-4">
              {activeRuns.size} {activeRuns.size === 1 ? "process" : "processes"}
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
              status={connected ? "connected" : projectId ? "connecting" : "disconnected"}
              label={connected ? (hasActivity ? "Streaming" : "Connected") : projectId ? "Connecting..." : "No session"}
            />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0">
          {!projectId && (
            <p className="text-xs text-muted-foreground px-3 py-4 text-center">
              No project selected
            </p>
          )}
          {projectId && (
            <div
              ref={containerRef}
              className="h-full w-full px-1 py-1"
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
