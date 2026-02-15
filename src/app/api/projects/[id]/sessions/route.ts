import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM sessions WHERE project_id = $1 ORDER BY created_at DESC`,
    [id]
  );
  return NextResponse.json(result.rows);
}
