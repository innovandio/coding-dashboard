import { watch, type FSWatcher } from "fs";
import { stat } from "fs/promises";
import { join } from "path";
import { getPool } from "./db";
import { getEventBus, type BusEvent } from "./event-bus";
import { parseGsdFiles } from "./gsd-parser";

interface WatcherEntry {
  projectId: string;
  workspacePath: string;
  watchers: FSWatcher[];
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

interface GsdWatcherState {
  entries: Map<string, WatcherEntry>;
}

const globalForWatcher = globalThis as unknown as {
  gsdWatcherState?: GsdWatcherState;
};

function getState(): GsdWatcherState {
  if (!globalForWatcher.gsdWatcherState) {
    globalForWatcher.gsdWatcherState = { entries: new Map() };
  }
  return globalForWatcher.gsdWatcherState;
}

async function refreshProject(projectId: string, workspacePath: string) {
  const pool = getPool();
  const bus = getEventBus();

  try {
    const tasks = await parseGsdFiles(workspacePath, projectId);

    const taskIds: string[] = [];
    for (const task of tasks) {
      taskIds.push(task.id);
      await pool.query(
        `INSERT INTO gsd_tasks (id, project_id, title, status, wave, file_path, meta, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (id) DO UPDATE SET
           title = $3, status = $4, wave = $5, file_path = $6, meta = $7, updated_at = now()`,
        [task.id, task.project_id, task.title, task.status, task.wave, task.file_path, JSON.stringify(task.meta)]
      );
    }

    // Delete tasks that no longer exist in the files
    if (taskIds.length > 0) {
      await pool.query(
        `DELETE FROM gsd_tasks WHERE project_id = $1 AND id != ALL($2)`,
        [projectId, taskIds]
      );
    } else {
      await pool.query(
        `DELETE FROM gsd_tasks WHERE project_id = $1`,
        [projectId]
      );
    }

    // Emit gsd_update event so SSE clients refresh immediately
    const busEvent: BusEvent = {
      id: Date.now(),
      project_id: projectId,
      session_id: null,
      agent_id: null,
      source: "gsd-watcher",
      event_type: "gsd_update",
      payload: { task_count: tasks.length },
      created_at: new Date().toISOString(),
    };
    bus.emit("event", busEvent);

    console.log(`[gsd-watcher] Refreshed ${tasks.length} tasks for project ${projectId}`);
  } catch (err) {
    console.error(`[gsd-watcher] Error refreshing project ${projectId}:`, err);
  }
}

function scheduleRefresh(entry: WatcherEntry) {
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    refreshProject(entry.projectId, entry.workspacePath);
  }, 500);
}

async function watchProject(projectId: string, workspacePath: string): Promise<WatcherEntry> {
  const entry: WatcherEntry = {
    projectId,
    workspacePath,
    watchers: [],
    debounceTimer: null,
  };

  const onChange = () => scheduleRefresh(entry);

  // Watch .planning/ directory recursively
  const planningDir = join(workspacePath, ".planning");
  try {
    const s = await stat(planningDir);
    if (s.isDirectory()) {
      const w = watch(planningDir, { recursive: true }, onChange);
      w.on("error", () => {}); // ignore watch errors
      entry.watchers.push(w);
    }
  } catch {
    // .planning/ doesn't exist yet — that's fine
  }

  // Watch root STATE.md and PLAN.md
  for (const file of ["STATE.md", "PLAN.md"]) {
    const filePath = join(workspacePath, file);
    try {
      await stat(filePath);
      const w = watch(filePath, onChange);
      w.on("error", () => {});
      entry.watchers.push(w);
    } catch {
      // file doesn't exist
    }
  }

  return entry;
}

function stopEntry(entry: WatcherEntry) {
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  for (const w of entry.watchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  entry.watchers = [];
}

export async function initGsdWatchers(
  projects: { id: string; workspace_path: string | null }[]
) {
  const state = getState();
  const activeIds = new Set<string>();

  for (const project of projects) {
    if (!project.workspace_path) continue;
    activeIds.add(project.id);

    // Skip if already watching with same path
    const existing = state.entries.get(project.id);
    if (existing && existing.workspacePath === project.workspace_path) continue;

    // Stop old watcher if path changed
    if (existing) stopEntry(existing);

    const entry = await watchProject(project.id, project.workspace_path);
    state.entries.set(project.id, entry);
    console.log(`[gsd-watcher] Watching project ${project.id} at ${project.workspace_path}`);

    // Initial parse so DB is up to date immediately
    refreshProject(project.id, project.workspace_path);
  }

  // Remove watchers for projects no longer in the list
  for (const [id, entry] of state.entries) {
    if (!activeIds.has(id)) {
      stopEntry(entry);
      state.entries.delete(id);
      console.log(`[gsd-watcher] Stopped watching project ${id}`);
    }
  }
}

export function stopGsdWatchers() {
  const state = getState();
  for (const [id, entry] of state.entries) {
    stopEntry(entry);
    console.log(`[gsd-watcher] Stopped watching project ${id}`);
  }
  state.entries.clear();
}
