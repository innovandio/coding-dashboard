import { sendGatewayRequest } from "@/lib/gateway-ingestor";

export async function POST(req: Request) {
  try {
    const { runId } = await req.json();

    if (!runId) {
      return Response.json({ error: "runId required" }, { status: 400 });
    }

    const result = await sendGatewayRequest("pty.kill", { runId });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to kill PTY process" },
      { status: 502 },
    );
  }
}
