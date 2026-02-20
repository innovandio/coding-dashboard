/**
 * Server-side PTY event emitter.
 * The gateway-ingestor forwards pty.* events here;
 * the /api/pty/stream SSE endpoint subscribes and streams to browsers.
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
  pid?: number;
}

const globalForPty = globalThis as unknown as { ptyEmitter?: EventEmitter };

export function getPtyEmitter(): EventEmitter {
  if (!globalForPty.ptyEmitter) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    globalForPty.ptyEmitter = emitter;
  }
  return globalForPty.ptyEmitter;
}
