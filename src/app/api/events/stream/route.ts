import { getEventBus, type BusEvent } from "@/lib/event-bus";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filterProjectId = url.searchParams.get("project_id");
  const filterSessionId = url.searchParams.get("session_id");

  const bus = getEventBus();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const onEvent = (ev: BusEvent) => {
        if (filterProjectId && ev.project_id !== filterProjectId) return;
        // Allow chat events through even when session filter is active
        // (chat session ID differs from monitoring session)
        if (filterSessionId && ev.session_id !== filterSessionId && ev.event_type !== "chat" && ev.event_type !== "agent") return;

        const data = JSON.stringify(ev);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      bus.on("event", onEvent);

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
        bus.off("event", onEvent);
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
