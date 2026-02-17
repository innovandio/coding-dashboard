"use client";

import { useState, useEffect, useRef } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { SessionTabs } from "@/components/layout/session-tabs";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { useDashboardState } from "@/hooks/use-dashboard-state";
import { useAgentActivity } from "@/components/activity/use-agent-activity";

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

  const { lifecycleState } = useAgentActivity(events);
  const [sphereActive, setSphereActive] = useState(false);
  const prevLifecycle = useRef(lifecycleState);

  // Auto-sync: activate when agent starts running, deactivate when it stops
  useEffect(() => {
    if (prevLifecycle.current !== lifecycleState) {
      if (lifecycleState === "running") {
        setSphereActive(true);
      } else if (prevLifecycle.current === "running") {
        setSphereActive(false);
      }
      prevLifecycle.current = lifecycleState;
    }
  }, [lifecycleState]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <TopBar
        health={health}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        onProjectAdded={fetchProjects}
        sphereActive={sphereActive}
        onSphereToggle={setSphereActive}
      />
      <SessionTabs
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
      />
      <DashboardShell
        gsdTasks={gsdTasks}
        events={events}
        projectId={selectedProjectId}
        agentActive={sphereActive}
      />
    </div>
  );
}
