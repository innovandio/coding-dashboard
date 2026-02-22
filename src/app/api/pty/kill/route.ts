import { sendGatewayRequest } from "@/lib/gateway-ingestor";
import { requireAuth } from "@/lib/auth-utils";

export async function POST(req: Request) {
  const session = await requireAuth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { runId } = await req.json();

    if (!runId) {
      return Response.json({ error: "runId required" }, { status: 400 });
    }

    const result = await sendGatewayRequest("pty.kill", { runId });
    return Response.json(result);
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to kill PTY process",
    });
  }
}
