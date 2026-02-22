import { getPtyEmitter, getRunBuffers, getRunMeta, deleteRunBuffer } from "@/lib/pty-emitter";
import { sendGatewayRequest } from "@/lib/gateway-ingestor";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");

  const emitter = getPtyEmitter();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const onData = (payload: Record<string, unknown>) => {
        if (projectId && payload.projectId !== projectId) return;
        const data = JSON.stringify({
          runId: payload.runId,
          data: payload.data,
        });
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch { /* stream closed */ }
      };

      const onStarted = (payload: Record<string, unknown>) => {
        if (projectId && payload.projectId !== projectId) return;
        const data = JSON.stringify({
          type: "started",
          runId: payload.runId,
          pid: payload.pid,
          label: payload.label,
          command: payload.command,
        });
        try {
          controller.enqueue(encoder.encode(`event: started\ndata: ${data}\n\n`));
        } catch { /* stream closed */ }
      };

      const onExited = (payload: Record<string, unknown>) => {
        if (projectId && payload.projectId !== projectId) return;
        const data = JSON.stringify({
          type: "exited",
          runId: payload.runId,
          pid: payload.pid,
        });
        try {
          controller.enqueue(encoder.encode(`event: exited\ndata: ${data}\n\n`));
        } catch { /* stream closed */ }
      };

      // Register listeners BEFORE replaying buffers so that if a process
      // exits during replay, the exited event is not missed.
      emitter.on("pty.data", onData);
      emitter.on("pty.started", onStarted);
      emitter.on("pty.exited", onExited);

      // Replay buffered screen data for active runs
      const replayedRunIds: string[] = [];
      if (projectId) {
        for (const { runId, data } of getRunBuffers(projectId)) {
          if (!data) continue;
          replayedRunIds.push(runId);
          try {
            const meta = getRunMeta(runId);
            controller.enqueue(
              encoder.encode(`event: started\ndata: ${JSON.stringify({
                type: "started", runId, label: meta?.label, command: meta?.command,
              })}\n\n`)
            );
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ runId, data })}\n\n`)
            );
          } catch { /* stream closed */ }
        }
      }

      // Reconcile: verify replayed runs are still active on the gateway.
      // If a pty.exited event was dropped, the buffer becomes stale.
      if (replayedRunIds.length > 0) {
        sendGatewayRequest("pty.list").then((result) => {
          const runs = (result as { runs?: Array<{ runId: string }> }).runs;
          if (!runs) return;
          const activeRunIds = new Set(runs.map((r) => r.runId));
          for (const runId of replayedRunIds) {
            if (!activeRunIds.has(runId)) {
              deleteRunBuffer(runId);
              try {
                controller.enqueue(
                  encoder.encode(`event: exited\ndata: ${JSON.stringify({ type: "exited", runId })}\n\n`)
                );
              } catch { /* stream closed */ }
            }
          }
        }).catch(() => { /* gateway unavailable */ });
      }

      // Keepalive every 15s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
        }
      }, 15000);

      req.signal.addEventListener("abort", () => {
        emitter.off("pty.data", onData);
        emitter.off("pty.started", onStarted);
        emitter.off("pty.exited", onExited);
        clearInterval(keepalive);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
