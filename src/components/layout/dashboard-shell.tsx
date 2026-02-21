"use client";

import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { TaskBoard } from "@/components/gsd/task-board";
import { ChatPanel } from "@/components/chat/chat-panel";
import { PtyPanel } from "@/components/terminal/pty-panel";
import { AiBrainSphere } from "@/components/shared/ai-brain-sphere";
import type { GsdTask } from "@/hooks/use-dashboard-state";
import type { BusEvent } from "@/lib/event-bus";
import type { ConnectionState } from "@/lib/gateway-protocol";

const connectionLabels: Record<ConnectionState, string> = {
  connected: "Connected",
  connecting: "Connecting\u2026",
  authenticating: "Authenticating\u2026",
  reconnecting: "No Gateway",
  disconnected: "No Gateway",
};

export function DashboardShell({
  gsdTasks,
  events,
  projectId,
  agentActive,
  connectionState,
  terminalThinking,
  onTerminalThinkingChange,
}: {
  gsdTasks: GsdTask[];
  events: BusEvent[];
  projectId: string | null;
  agentActive: boolean;
  connectionState: ConnectionState;
  terminalThinking?: boolean;
  onTerminalThinkingChange?: (thinking: boolean) => void;
}) {
  const isConnected = connectionState === "connected";
  const isTransitioning = connectionState === "connecting" || connectionState === "authenticating";
  return (
    <div className="flex-1 overflow-hidden">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel defaultSize={35} minSize={15}>
          <div className="flex h-full">
            <div className="flex-1 min-w-0">
              <TaskBoard tasks={gsdTasks} />
            </div>
            <div className="w-[335px] shrink-0 border-l border-border flex flex-col items-center justify-center bg-card relative">
              <AiBrainSphere isActive={agentActive} isConnected={isConnected} isThinking={terminalThinking} size={256} />
              <span className="absolute bottom-4 inline-flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full transition-colors duration-500 ${
                    isConnected
                      ? "bg-green-500"
                      : isTransitioning
                        ? "bg-yellow-500 animate-pulse"
                        : "bg-muted-foreground/50"
                  }`}
                />
                <span className="text-[11px] text-muted-foreground">
                  {connectionLabels[connectionState] ?? connectionState}
                </span>
              </span>
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={65} minSize={30}>
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize={50} minSize={30}>
              <ChatPanel projectId={projectId} events={events} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={20}>
              <PtyPanel projectId={projectId} onThinkingChange={onTerminalThinkingChange} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
