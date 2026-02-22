import { NextRequest, NextResponse } from "next/server";
import { sendGatewayRequest } from "@/lib/gateway-ingestor";
import { requireAuth } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sessionKey } = await req.json();
  if (!sessionKey) {
    return NextResponse.json({ error: "sessionKey required" }, { status: 400 });
  }

  try {
    await sendGatewayRequest("chat.abort", { sessionKey });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
