import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { readHeartbeatConfig } from "@/lib/heartbeat-config";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = getPool();
  const { rows } = await pool.query<{ agent_id: string }>(
    `SELECT agent_id FROM projects WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const config = await readHeartbeatConfig(rows[0].agent_id);
  return NextResponse.json(config);
}
