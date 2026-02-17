"use client";

import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { TaskBoard } from "@/components/gsd/task-board";
import { ChatPanel } from "@/components/chat/chat-panel";
import { TmuxPanel } from "@/components/tmux/tmux-panel";
import { AiBrainSphere } from "@/components/shared/ai-brain-sphere";
import type { GsdTask } from "@/hooks/use-dashboard-state";
import type { BusEvent } from "@/lib/event-bus";

export function DashboardShell({
  gsdTasks,
  events,
  projectId,
  agentActive,
}: {
  gsdTasks: GsdTask[];
  events: BusEvent[];
  projectId: string | null;
  agentActive: boolean;
}) {
  return (
    <div className="flex-1 overflow-hidden">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel defaultSize={35} minSize={15}>
          <div className="flex h-full">
            <div className="flex-1 min-w-0">
              <TaskBoard tasks={gsdTasks} />
            </div>
            <div className="w-[335px] shrink-0 border-l border-border flex flex-col items-center justify-center bg-card">
              <AiBrainSphere isActive={agentActive} size={256} />
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
              <TmuxPanel projectId={projectId} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
