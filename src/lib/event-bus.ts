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

declare global {
  var __eventBus: EventEmitter | undefined;
}

// Synthetic ID counter for bus-only events (negative to avoid collision with DB bigserial)
let syntheticIdCounter = 0;

export function nextSyntheticId(): number {
  return --syntheticIdCounter;
}

export function getEventBus(): EventEmitter {
  if (!globalThis.__eventBus) {
    const bus = new EventEmitter();
    bus.setMaxListeners(100);
    globalThis.__eventBus = bus;
  }
  return globalThis.__eventBus;
}
