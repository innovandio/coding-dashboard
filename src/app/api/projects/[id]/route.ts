import { NextRequest, NextResponse } from "next/server";
import { homedir } from "os";
import { getPool } from "@/lib/db";
import { refreshGsdWatchers } from "@/lib/gateway-ingestor";
import { syncGatewayMounts } from "@/lib/agent-scaffold";

function expandTilde(p: string): string {
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  if (p === "~") return homedir();
  return p;
}

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pool = getPool();
  const result = await pool.query(`SELECT * FROM projects WHERE id = $1`, [id]);
  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result.rows[0]);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const pool = getPool();

  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (body.name !== undefined) {
    sets.push(`name = $${idx++}`);
    vals.push(body.name);
  }
  if (body.workspace_path !== undefined) {
    sets.push(`workspace_path = $${idx++}`);
    vals.push(expandTilde(body.workspace_path));
  }
  if (body.meta !== undefined) {
    sets.push(`meta = COALESCE(meta, '{}'::jsonb) || $${idx++}::jsonb`);
    vals.push(JSON.stringify(body.meta));
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  vals.push(id);
  await pool.query(
    `UPDATE projects SET ${sets.join(", ")} WHERE id = $${idx}`,
    vals
  );

  // Refresh watchers if workspace_path changed
  if (body.workspace_path !== undefined) {
    refreshGsdWatchers();
    syncGatewayMounts().catch((err) =>
      console.warn("[projects] Failed to sync gateway mounts:", err)
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pool = getPool();

  await pool.query(`DELETE FROM projects WHERE id = $1`, [id]);

  // Refresh GSD watchers to remove the deleted project's watcher
  refreshGsdWatchers();
  syncGatewayMounts().catch((err) =>
    console.warn("[projects] Failed to sync gateway mounts:", err)
  );

  return NextResponse.json({ ok: true });
}
