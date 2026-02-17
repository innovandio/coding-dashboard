import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  ensureTmuxSession,
  launchClaudeInSession,
  registerManagedSession,
  tmuxSessionName,
} from "@/lib/tmux-scanner";
import { syncAgentInstructions } from "@/lib/agent-instructions";

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

  // Look up the project (needed for both new and existing sessions)
  const project = await pool.query(
    `SELECT agent_id, name, workspace_path FROM projects WHERE id = $1`,
    [projectId]
  );
  const row = project.rows[0];
  const agentId = row?.agent_id ?? projectId;
  const projectName = row?.name ?? projectId;
  const workspacePath = row?.workspace_path ?? "";

  // Always ensure tmux session exists and is registered (survives server restarts)
  const tmuxName = tmuxSessionName(projectId);
  try {
    await ensureTmuxSession(projectId);
    if (workspacePath) {
      await launchClaudeInSession(tmuxName, workspacePath);
    }
    registerManagedSession(projectId, tmuxName, workspacePath);

    await pool.query(
      `UPDATE projects SET meta = COALESCE(meta, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ tmux_session: tmuxName }), projectId]
    );

    // Update AGENTS.md with tmux session info
    if (workspacePath) {
      syncAgentInstructions({
        projectId,
        projectName,
        workspacePath,
        tmuxSession: tmuxName,
      }).catch((err) => {
        console.warn("[chat.session] Failed to sync agent instructions:", err);
      });
    }
  } catch (err) {
    console.warn("[chat.session] Failed to set up tmux session:", err);
  }

  // Check if project already has a chat session
  const existing = await pool.query(
    `SELECT id, session_key FROM sessions WHERE project_id = $1 AND meta->>'type' = 'chat' LIMIT 1`,
    [projectId]
  );

  if (existing.rows.length > 0) {
    return NextResponse.json({
      sessionId: existing.rows[0].id,
      sessionKey: existing.rows[0].session_key,
      tmuxSession: tmuxName,
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

  return NextResponse.json({ sessionId, sessionKey, tmuxSession: tmuxName, isNew: true });
}
