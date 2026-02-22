import { sendGatewayRequest } from "@/lib/gateway-ingestor";

export async function POST(req: Request) {
  try {
    const { cols, rows } = await req.json();
    if (typeof cols !== "number" || typeof rows !== "number" || cols < 1 || rows < 1) {
      return Response.json({ error: "cols and rows must be positive numbers" }, { status: 400 });
    }
    await sendGatewayRequest("pty.resize", { cols, rows });
    return Response.json({ ok: true, cols, rows });
  } catch (err) {
    // Non-fatal — no active PTY or gateway not connected
    return Response.json({ ok: false, error: String(err) });
  }
}
