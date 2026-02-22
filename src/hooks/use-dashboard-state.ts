"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { BusEvent } from "@/lib/event-bus";
import type { ConnectionState } from "@/lib/gateway-protocol";
import { useEventStream } from "@/components/shared/use-event-stream";
import { MAX_EVENTS } from "@/lib/constants";
import { toast } from "sonner";

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
  needsSetup: boolean;
  needsClaudeLogin: boolean;
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
  needsSetup: false,
  needsClaudeLogin: false,
};

const defaultTasks: GsdTask[] = [];

export function useDashboardState() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>(defaultHealth);
  const [gsdTasks, setGsdTasks] = useState<GsdTask[]>(defaultTasks);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [events, setEvents] = useState<BusEvent[]>([]);

  // Track GSD update signal from SSE
  const [gsdUpdateTrigger, setGsdUpdateTrigger] = useState(0);

  // Batch incoming events to avoid per-event state updates / array copies.
  // Events are accumulated in a ref and flushed on the next animation frame.
  const pendingEventsRef = useRef<BusEvent[]>([]);
  const rafRef = useRef<number | null>(null);

  const flushEvents = useCallback(() => {
    rafRef.current = null;
    const batch = pendingEventsRef.current;
    if (batch.length === 0) return;
    pendingEventsRef.current = [];

    setEvents((prev) => {
      const next = prev.concat(batch);
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
    });
  }, []);

  // SSE event stream
  const handleEvent = useCallback(
    (ev: BusEvent) => {
      // When a gsd_update event arrives, trigger an immediate re-fetch of tasks
      if (ev.event_type === "gsd_update") {
        setGsdUpdateTrigger((n) => n + 1);
        return;
      }

      pendingEventsRef.current.push(ev);
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushEvents);
      }
    },
    [flushEvents],
  );

  useEventStream(selectedProjectId, selectedSessionId, handleEvent);

  // Fetch projects (AbortController cancels in-flight requests on re-call)
  const projectsAbortRef = useRef<AbortController | null>(null);
  const fetchProjects = useCallback(async () => {
    projectsAbortRef.current?.abort();
    const controller = new AbortController();
    projectsAbortRef.current = controller;
    setLoadingProjects(true);
    try {
      const res = await fetch("/api/projects", { signal: controller.signal });
      if (!res.ok) throw new Error("Failed to load projects");
      const data = await res.json();
      setProjects(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Failed to load projects");
    } finally {
      if (!controller.signal.aborted) setLoadingProjects(false);
    }
  }, []);

  // Fetch sessions for selected project
  const sessionsAbortRef = useRef<AbortController | null>(null);
  const fetchSessions = useCallback(async () => {
    sessionsAbortRef.current?.abort();
    if (!selectedProjectId) {
      setSessions([]);
      setLoadingSessions(false);
      return;
    }
    const controller = new AbortController();
    sessionsAbortRef.current = controller;
    setLoadingSessions(true);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/sessions`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Failed to load sessions");
      const data = await res.json();
      setSessions(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Failed to load sessions");
    } finally {
      if (!controller.signal.aborted) setLoadingSessions(false);
    }
  }, [selectedProjectId]);

  // Health polling (2s)
  useEffect(() => {
    let healthFailCount = 0;
    const poll = async () => {
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        setHealth(data);
        healthFailCount = 0;
      } catch {
        healthFailCount++;
        if (healthFailCount === 3) {
          toast.error("Dashboard server unreachable");
        }
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  // Clear stale state when the backend signals a reset (fresh volumes)
  useEffect(() => {
    if (health.needsSetup) {
      setProjects([]);
      setSelectedProjectId(null);
      setSessions([]);
      setSelectedSessionId(null);
      setGsdTasks(defaultTasks);
      setEvents([]);
    }
  }, [health.needsSetup]);

  // Fetch GSD tasks — called on project change, SSE gsd_update events, and 60s fallback poll
  const fetchGsdTasks = useCallback(async () => {
    try {
      const params = selectedProjectId ? `?project_id=${selectedProjectId}` : "";
      const res = await fetch(`/api/gsd/tasks${params}`);
      if (!res.ok) throw new Error("Failed to load tasks");
      const data = await res.json();
      setGsdTasks(data);
      return data as GsdTask[];
    } catch {
      toast.error("Failed to refresh GSD tasks");
      return [];
    }
  }, [selectedProjectId]);

  // Fetch tasks when project changes
  useEffect(() => {
    fetchGsdTasks();
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
    // Discard any pending batched events from the previous project
    pendingEventsRef.current = [];
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
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
    loadingProjects,
    loadingSessions,
    fetchProjects,
    fetchSessions,
  };
}
