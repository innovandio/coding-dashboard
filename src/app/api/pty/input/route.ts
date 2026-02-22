import { sendGatewayRequest } from "@/lib/gateway-ingestor";

export async function POST(req: Request) {
  try {
    const { runId, data } = await req.json();

    if (!runId || typeof data !== "string") {
      return Response.json({ error: "runId and data required" }, { status: 400 });
    }

    const result = await sendGatewayRequest("pty.input", { runId, data });
    return Response.json(result);
  } catch (err) {
    // Best-effort — stale runs or disconnected gateway are expected.
    // Return 200 so the browser doesn't log console errors on every keystroke.
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send PTY input",
    });
  }
}
