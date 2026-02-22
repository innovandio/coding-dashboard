import { NextRequest, NextResponse } from "next/server";
import { getEventBus, nextSyntheticId, type BusEvent } from "@/lib/event-bus";
import { sendGatewayRequest } from "@/lib/gateway-ingestor";
import { requireAuth } from "@/lib/auth-utils";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sessionId, sessionKey, message } = await req.json();
  if (!sessionKey || !message) {
    return NextResponse.json({ error: "sessionKey and message required" }, { status: 400 });
  }

  const bus = getEventBus();

  // Emit on bus for instant SSE feedback (no DB persist)
  const busEvent: BusEvent = {
    id: nextSyntheticId(),
    project_id: null,
    session_id: sessionId ?? null,
    agent_id: null,
    source: "user",
    event_type: "chat",
    payload: {
      sessionKey,
      role: "user",
      content: message,
    },
    created_at: new Date().toISOString(),
  };
  bus.emit("event", busEvent);

  // Fire-and-forget: send to gateway
  const idempotencyKey = randomUUID();
  sendGatewayRequest("chat.send", {
    sessionKey,
    message,
    idempotencyKey,
  }).catch((err) => {
    console.error("[chat.send] Gateway error:", err.message);
  });

  return NextResponse.json({ ok: true });
}
