import { NextRequest, NextResponse } from "next/server";
import { homedir } from "os";
import { getPool } from "@/lib/db";
import { refreshGsdWatchers } from "@/lib/gateway-ingestor";
import { scaffoldAgentFiles, syncGatewayMounts } from "@/lib/agent-scaffold";

/** Expand leading ~ to the user's home directory. */
function expandTilde(p: string): string {
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  if (p === "~") return homedir();
  return p;
}

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = getPool();
  const result = await pool.query(`SELECT * FROM projects ORDER BY created_at DESC`);
  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { id, agent_id, name, workspace_path } = body;

  if (!id || !agent_id || !name) {
    return NextResponse.json({ error: "id, agent_id, and name are required" }, { status: 400 });
  }

  const resolvedPath = workspace_path ? expandTilde(workspace_path) : null;

  const pool = getPool();
  await pool.query(
    `INSERT INTO projects (id, agent_id, name, workspace_path)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = $3, workspace_path = $4`,
    [id, agent_id, name, resolvedPath],
  );

  // Regenerate workspace volume mounts and recreate the gateway container.
  // Awaited so the client knows when the restart is in progress.
  if (resolvedPath) {
    try {
      await syncGatewayMounts();
    } catch (err) {
      console.warn("[projects] Failed to sync gateway mounts:", err);
    }
  }

  // Scaffold agent MD files AFTER the gateway restart so `docker compose exec`
  // targets the new container (which has the agent-dir volume mounted).
  // Awaited so templates are written before the response returns.
  try {
    await scaffoldAgentFiles({
      projectId: id,
      projectName: name,
      force: true,
    });
  } catch (err) {
    console.warn(`[projects] Failed to scaffold agent files for ${id}:`, err);
  }

  // Refresh GSD watchers to include the new/updated project
  refreshGsdWatchers();

  return NextResponse.json({ ok: true, id });
}
