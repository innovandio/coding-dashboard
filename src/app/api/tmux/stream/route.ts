import {
  getTmuxEmitter,
  setActiveTmuxCapture,
  addTmuxClient,
  removeTmuxClient,
  type TmuxOutputEvent,
} from "@/lib/tmux-scanner";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionName = url.searchParams.get("session");

  if (!sessionName) {
    return new Response("Missing session parameter", { status: 400 });
  }

  const emitter = getTmuxEmitter();
  const encoder = new TextEncoder();

  addTmuxClient();
  setActiveTmuxCapture(sessionName);

  const stream = new ReadableStream({
    start(controller) {
      const onOutput = (ev: TmuxOutputEvent) => {
        if (ev.session !== sessionName) return;
        const data = JSON.stringify(ev);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      emitter.on("tmux:output", onOutput);

      // Send keepalive every 15s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
        }
      }, 15000);

      // Cleanup on abort
      req.signal.addEventListener("abort", () => {
        emitter.off("tmux:output", onOutput);
        clearInterval(keepalive);
        removeTmuxClient();
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
