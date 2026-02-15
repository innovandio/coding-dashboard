"use client";

import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { TaskBoard } from "@/components/gsd/task-board";
import { ChatPanel } from "@/components/chat/chat-panel";
import type { GsdTask } from "@/hooks/use-dashboard-state";
import type { BusEvent } from "@/lib/event-bus";

export function DashboardShell({
  gsdTasks,
  events,
  projectId,
}: {
  gsdTasks: GsdTask[];
  events: BusEvent[];
  projectId: string | null;
}) {
  return (
    <div className="flex-1 overflow-hidden">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel defaultSize={35} minSize={15}>
          <TaskBoard tasks={gsdTasks} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={65} minSize={30}>
          <ChatPanel projectId={projectId} events={events} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
