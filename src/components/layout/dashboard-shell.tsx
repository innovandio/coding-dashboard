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

export function DashboardShell({
  gsdTasks,
  events,
  projectId,
  agentActive,
  terminalThinking,
  onTerminalThinkingChange,
  onSphereToggle,
}: {
  gsdTasks: GsdTask[];
  events: BusEvent[];
  projectId: string | null;
  agentActive: boolean;
  terminalThinking?: boolean;
  onTerminalThinkingChange?: (thinking: boolean) => void;
  onSphereToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex-1 overflow-hidden">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel defaultSize={35} minSize={15}>
          <div className="flex h-full">
            <div className="flex-1 min-w-0">
              <TaskBoard tasks={gsdTasks} />
            </div>
            <div className="w-[335px] shrink-0 border-l border-border flex flex-col items-center justify-center bg-card relative">
              <AiBrainSphere isActive={agentActive} isThinking={terminalThinking} size={256} />
              <button
                onClick={() => onSphereToggle(!agentActive)}
                className="absolute bottom-4 inline-flex items-center h-5 w-9 rounded-full transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{
                  background: agentActive
                    ? "rgba(40, 100, 200, 0.35)"
                    : "rgba(255, 255, 255, 0.08)",
                  border: `1px solid ${agentActive ? "rgba(60, 140, 255, 0.4)" : "rgba(255, 255, 255, 0.1)"}`,
                }}
                aria-label="Toggle AI sphere"
                role="switch"
                aria-checked={agentActive}
              >
                <span
                  className="inline-block h-3.5 w-3.5 rounded-full transition-all duration-300"
                  style={{
                    transform: agentActive ? "translateX(17px)" : "translateX(3px)",
                    background: agentActive ? "rgba(80, 160, 255, 0.85)" : "rgba(255, 255, 255, 0.22)",
                    boxShadow: agentActive ? "0 0 8px rgba(80, 160, 255, 0.5)" : "none",
                  }}
                />
              </button>
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
