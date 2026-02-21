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
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to send PTY input" },
      { status: 502 },
    );
  }
}
