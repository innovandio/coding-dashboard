import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getEventBus, type BusEvent } from "@/lib/event-bus";
import { sendGatewayRequest } from "@/lib/gateway-ingestor";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { sessionId, sessionKey, message } = await req.json();
  if (!sessionKey || !message) {
    return NextResponse.json(
      { error: "sessionKey and message required" },
      { status: 400 }
    );
  }

  const pool = getPool();
  const bus = getEventBus();

  // Look up project_id for this session
  let projectId: string | null = null;
  if (sessionId) {
    const session = await pool.query(
      `SELECT project_id FROM sessions WHERE id = $1`,
      [sessionId]
    );
    if (session.rows.length > 0) {
      projectId = session.rows[0].project_id;
    }
  }

  // Store user message as event
  const userPayload = {
    sessionKey,
    role: "user",
    content: message,
  };

  const result = await pool.query(
    `INSERT INTO events (project_id, session_id, agent_id, source, event_type, payload)
     VALUES ($1, $2, $3, 'user', 'chat', $4)
     RETURNING id, created_at`,
    [projectId, sessionId, projectId, JSON.stringify(userPayload)]
  );

  const row = result.rows[0];
  const busEvent: BusEvent = {
    id: row.id,
    project_id: projectId,
    session_id: sessionId,
    agent_id: projectId,
    source: "user",
    event_type: "chat",
    payload: userPayload,
    created_at: row.created_at,
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
