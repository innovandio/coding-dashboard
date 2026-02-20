import { getPtyEmitter } from "@/lib/pty-emitter";

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

      emitter.on("pty.data", onData);
      emitter.on("pty.started", onStarted);
      emitter.on("pty.exited", onExited);

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
