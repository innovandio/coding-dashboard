import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

// Build session key in the format the gateway expects: agent:<agentId>:main
function buildSessionKey(agentId: string): string {
  const normalized = agentId.trim().toLowerCase();
  return `agent:${normalized}:main`;
}

export async function POST(req: NextRequest) {
  const { projectId } = await req.json();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const pool = getPool();

  // Look up the project
  const project = await pool.query(
    `SELECT agent_id, name, workspace_path FROM projects WHERE id = $1`,
    [projectId]
  );
  const row = project.rows[0];
  const agentId = row?.agent_id ?? projectId;

  // Check if project already has a chat session
  const existing = await pool.query(
    `SELECT id, session_key FROM sessions WHERE project_id = $1 AND meta->>'type' = 'chat' LIMIT 1`,
    [projectId]
  );

  if (existing.rows.length > 0) {
    return NextResponse.json({
      sessionId: existing.rows[0].id,
      sessionKey: existing.rows[0].session_key,
    });
  }

  // Build session key directly — gateway accepts agent:<agentId>:main format
  const sessionKey = buildSessionKey(agentId);
  const sessionId = `chat-${projectId}-${Date.now()}`;

  await pool.query(
    `INSERT INTO sessions (id, project_id, session_key, meta)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [sessionId, projectId, sessionKey, JSON.stringify({ type: "chat" })]
  );

  return NextResponse.json({ sessionId, sessionKey, isNew: true });
}
