"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { SessionTabs } from "@/components/layout/session-tabs";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { SetupDialog } from "@/components/setup/setup-dialog";
import { ClaudeLoginDialog } from "@/components/setup/claude-login-dialog";
import { useDashboardState } from "@/hooks/use-dashboard-state";
import { useAgentActivity } from "@/components/activity/use-agent-activity";
import type { ConnectionState } from "@/lib/gateway-protocol";

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
  const [terminalThinking, setTerminalThinking] = useState(false);
  // Latch: once the setup dialog opens, keep it open until the process exits.
  // health.needsSetup may flip to false mid-wizard (config written early).
  const [setupOpen, setSetupOpen] = useState(false);
  const [claudeLoginOpen, setClaudeLoginOpen] = useState(false);
  // Dismissed latch: once the user completes/closes the login dialog,
  // don't reopen it until needsClaudeLogin flips to false first.
  const [claudeLoginDismissed, setClaudeLoginDismissed] = useState(false);

  useEffect(() => {
    if (health.needsSetup && !setupOpen) {
      setSetupOpen(true);
    }
  }, [health.needsSetup, setupOpen]);

  // Reset dismissed latch when needsClaudeLogin becomes false
  useEffect(() => {
    if (!health.needsClaudeLogin) {
      setClaudeLoginDismissed(false);
    }
  }, [health.needsClaudeLogin]);

  // Only show claude login dialog after setup is complete and not dismissed
  useEffect(() => {
    if (
      !health.needsSetup &&
      health.needsClaudeLogin &&
      !claudeLoginOpen &&
      !claudeLoginDismissed &&
      !setupOpen
    ) {
      setClaudeLoginOpen(true);
    }
  }, [health.needsSetup, health.needsClaudeLogin, claudeLoginOpen, claudeLoginDismissed, setupOpen]);

  const handleSetupComplete = useCallback(() => {
    setSetupOpen(false);
    fetchProjects();
  }, [fetchProjects]);

  const handleClaudeLoginComplete = useCallback(() => {
    setClaudeLoginOpen(false);
    setClaudeLoginDismissed(true);
  }, []);

  // Sphere is active when an agent is running or terminal is thinking
  const agentActive = lifecycleState === "running" || terminalThinking;

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <SetupDialog
        open={setupOpen}
        onSetupComplete={handleSetupComplete}
      />
      <ClaudeLoginDialog
        open={claudeLoginOpen}
        onLoginComplete={handleClaudeLoginComplete}
      />
      <TopBar
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
      <DashboardShell
        gsdTasks={gsdTasks}
        events={events}
        projectId={selectedProjectId}
        agentActive={agentActive}
        connectionState={health.connectionState as ConnectionState}
        terminalThinking={terminalThinking}
        onTerminalThinkingChange={setTerminalThinking}
      />
    </div>
  );
}
