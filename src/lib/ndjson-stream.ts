export type StepStatus = "pending" | "processing" | "success" | "error";

export interface StepEvent {
  step: number;
  status: StepStatus;
  label?: string;
  error?: string;
}

export interface DoneEvent {
  done: true;
  success: boolean;
  error?: string;
}

export type ProgressEvent = StepEvent | DoneEvent;

/**
 * Create an NDJSON progress stream for streaming step-by-step progress
 * to the client. Returns a ReadableStream and helpers to enqueue events.
 */
export function createProgressStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  function send(event: ProgressEvent) {
    controller?.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
  }

  function close() {
    controller?.close();
  }

  return { stream, send, close };
}
