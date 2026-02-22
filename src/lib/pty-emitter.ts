/**
 * Server-side PTY event emitter.
 * The gateway-ingestor forwards pty.* events here;
 * the /api/pty/stream SSE endpoint subscribes and streams to browsers.
 *
 * Also maintains a per-run screen buffer so that newly connecting
 * clients can catch up with the current terminal state immediately.
 */
import { EventEmitter } from "events";

export interface PtyDataEvent {
  runId: string;
  projectId?: string;
  backendId?: string;
  label?: string;
  data: string;
}

export interface PtyLifecycleEvent {
  runId: string;
  projectId?: string;
  backendId?: string;
  label?: string;
  command?: string;
  pid?: number;
}

/** Max bytes of output to buffer per run. */
const MAX_BUFFER_BYTES = 64 * 1024; // 64 KB

interface RunBuffer {
  projectId: string;
  chunks: string[];
  totalBytes: number;
}

interface RunMeta {
  label?: string;
  command?: string;
}

const globalForPty = globalThis as unknown as {
  ptyEmitter?: EventEmitter;
  ptyScreenBuffers?: Map<string, RunBuffer>;
  ptyRunMeta?: Map<string, RunMeta>;
};

function getScreenBuffers(): Map<string, RunBuffer> {
  if (!globalForPty.ptyScreenBuffers) {
    globalForPty.ptyScreenBuffers = new Map();
  }
  return globalForPty.ptyScreenBuffers;
}

function getMetaMap(): Map<string, RunMeta> {
  if (!globalForPty.ptyRunMeta) {
    globalForPty.ptyRunMeta = new Map();
  }
  return globalForPty.ptyRunMeta;
}

/** Return metadata (label, command) for a specific run. */
export function getRunMeta(runId: string): RunMeta | undefined {
  return getMetaMap().get(runId);
}

/** Remove a stale run's buffer and metadata. */
export function deleteRunBuffer(runId: string): void {
  getScreenBuffers().delete(runId);
  getMetaMap().delete(runId);
}

/** Return buffered output for all active runs belonging to a project. */
export function getRunBuffers(projectId: string): Array<{ runId: string; data: string }> {
  const buffers = getScreenBuffers();
  const result: Array<{ runId: string; data: string }> = [];
  for (const [runId, buf] of buffers) {
    if (buf.projectId === projectId) {
      result.push({ runId, data: buf.chunks.join("") });
    }
  }
  return result;
}

export function getPtyEmitter(): EventEmitter {
  if (!globalForPty.ptyEmitter) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);

    const buffers = getScreenBuffers();

    // Buffer pty output per run
    emitter.on("pty.data", (evt: PtyDataEvent) => {
      if (!evt.runId || !evt.projectId) return;
      let buf = buffers.get(evt.runId);
      if (!buf) {
        buf = { projectId: evt.projectId, chunks: [], totalBytes: 0 };
        buffers.set(evt.runId, buf);
      }
      buf.chunks.push(evt.data);
      buf.totalBytes += evt.data.length;
      // Trim from front when over limit
      while (buf.totalBytes > MAX_BUFFER_BYTES && buf.chunks.length > 1) {
        buf.totalBytes -= buf.chunks.shift()!.length;
      }
    });

    // Track new runs (create buffer entry even before data arrives)
    emitter.on("pty.started", (evt: PtyLifecycleEvent) => {
      if (!evt.runId || !evt.projectId) return;
      if (!buffers.has(evt.runId)) {
        buffers.set(evt.runId, { projectId: evt.projectId, chunks: [], totalBytes: 0 });
      }
      const metaMap = getMetaMap();
      metaMap.set(evt.runId, { label: evt.label, command: evt.command });
    });

    // Clean up buffer and metadata when run exits
    emitter.on("pty.exited", (evt: PtyLifecycleEvent) => {
      if (evt.runId) {
        buffers.delete(evt.runId);
        getMetaMap().delete(evt.runId);
      }
    });

    globalForPty.ptyEmitter = emitter;
  }
  return globalForPty.ptyEmitter;
}
