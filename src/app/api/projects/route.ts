import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { refreshGsdWatchers } from "@/lib/gateway-ingestor";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM projects ORDER BY created_at DESC`
  );
  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { id, agent_id, name, workspace_path } = body;

  if (!id || !agent_id || !name) {
    return NextResponse.json(
      { error: "id, agent_id, and name are required" },
      { status: 400 }
    );
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO projects (id, agent_id, name, workspace_path)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = $3, workspace_path = $4`,
    [id, agent_id, name, workspace_path ?? null]
  );

  // Refresh GSD watchers to include the new/updated project
  refreshGsdWatchers();

  return NextResponse.json({ ok: true, id });
}
