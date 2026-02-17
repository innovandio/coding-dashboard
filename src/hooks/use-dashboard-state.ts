"use client";

import { useState, useEffect, useCallback } from "react";
import type { BusEvent } from "@/lib/event-bus";
import type { ConnectionState } from "@/lib/gateway-protocol";
import { useEventStream } from "@/components/shared/use-event-stream";

export interface Project {
  id: string;
  agent_id: string;
  name: string;
  workspace_path: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  project_id: string;
  name: string | null;
  status: string;
  created_at: string;
}

export interface HealthState {
  connectionState: ConnectionState;
  lastTickAt: number | null;
  tickAgeMs: number | null;
  connectedSince: number | null;
  reconnectAttempts: number;
  agentIds: string[];
}

export interface GsdTask {
  id: string;
  project_id: string;
  title: string;
  status: string;
  wave: number | null;
  file_path: string;
  meta: { taskType?: "phase" | "plan"; phaseNumber?: number };
}

const defaultHealth: HealthState = {
  connectionState: "disconnected",
  lastTickAt: null,
  tickAgeMs: null,
  connectedSince: null,
  reconnectAttempts: 0,
  agentIds: [],
};

const defaultTasks: GsdTask[] = [];

export function useDashboardState() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>(defaultHealth);
  const [gsdTasks, setGsdTasks] = useState<GsdTask[]>(defaultTasks);
  const [events, setEvents] = useState<BusEvent[]>([]);

  // Track GSD update signal from SSE
  const [gsdUpdateTrigger, setGsdUpdateTrigger] = useState(0);

  // SSE event stream
  const handleEvent = useCallback((ev: BusEvent) => {
    // When a gsd_update event arrives, trigger an immediate re-fetch of tasks
    if (ev.event_type === "gsd_update") {
      setGsdUpdateTrigger((n) => n + 1);
      return;
    }

    setEvents((prev) => {
      const next = [...prev, ev];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  useEventStream(selectedProjectId, selectedSessionId, handleEvent);

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      setProjects(data);
    } catch {
      // ignore
    }
  }, []);

  // Fetch sessions for selected project
  const fetchSessions = useCallback(async () => {
    if (!selectedProjectId) {
      setSessions([]);
      return;
    }
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/sessions`);
      const data = await res.json();
      setSessions(data);
    } catch {
      // ignore
    }
  }, [selectedProjectId]);

  // Health polling (2s)
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        setHealth(data);
      } catch {
        // ignore
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  // Fetch GSD tasks — called on project change, SSE gsd_update events, and 60s fallback poll
  const fetchGsdTasks = useCallback(async () => {
    try {
      const params = selectedProjectId ? `?project_id=${selectedProjectId}` : "";
      const res = await fetch(`/api/gsd/tasks${params}`);
      const data = await res.json();
      setGsdTasks(data);
      return data as GsdTask[];
    } catch {
      return [];
    }
  }, [selectedProjectId]);

  // Initial load + one-time refresh if empty
  useEffect(() => {
    let refreshed = false;
    const initialLoad = async () => {
      const data = await fetchGsdTasks();
      if (!refreshed && selectedProjectId && data.length === 0) {
        refreshed = true;
        await fetch("/api/gsd/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: selectedProjectId }),
        });
        await fetchGsdTasks();
      }
    };
    initialLoad();
  }, [selectedProjectId, fetchGsdTasks]);

  // Re-fetch when SSE gsd_update event arrives
  useEffect(() => {
    if (gsdUpdateTrigger > 0) {
      fetchGsdTasks();
    }
  }, [gsdUpdateTrigger, fetchGsdTasks]);

  // Fallback polling at 60s
  useEffect(() => {
    const interval = setInterval(fetchGsdTasks, 60000);
    return () => clearInterval(interval);
  }, [fetchGsdTasks]);

  // Fetch projects on mount, auto-select first
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Auto-select first project when projects load and none is selected
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  // Fetch sessions when project changes
  useEffect(() => {
    fetchSessions();
    setSelectedSessionId(null);
    setEvents([]);
  }, [selectedProjectId, fetchSessions]);

  return {
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
    fetchSessions,
  };
}
