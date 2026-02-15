"use client";

import { TopBar } from "@/components/layout/top-bar";
import { SessionTabs } from "@/components/layout/session-tabs";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { useDashboardState } from "@/hooks/use-dashboard-state";

export default function Home() {
  const {
    projects,
    selectedProjectId,
    setSelectedProjectId,
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    health,
    gsdTasks,
    events,
    fetchProjects,
  } = useDashboardState();

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <TopBar
        health={health}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        onProjectAdded={fetchProjects}
      />
      <SessionTabs
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
      />
      <DashboardShell gsdTasks={gsdTasks} events={events} projectId={selectedProjectId} />
    </div>
  );
}
