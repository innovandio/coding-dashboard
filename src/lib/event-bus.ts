import { EventEmitter } from "events";

export type BusEvent = {
  id: number;
  project_id: string | null;
  session_id: string | null;
  agent_id: string | null;
  source: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

const globalForBus = globalThis as unknown as { eventBus?: EventEmitter };

export function getEventBus(): EventEmitter {
  if (!globalForBus.eventBus) {
    const bus = new EventEmitter();
    bus.setMaxListeners(100);
    globalForBus.eventBus = bus;
  }
  return globalForBus.eventBus;
}
