import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sessionId = sp.get("session_id");
  const limit = Math.min(parseInt(sp.get("limit") ?? "100", 10), 500);

  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM events
     WHERE session_id = $1 AND event_type = 'chat'
     ORDER BY id ASC
     LIMIT $2`,
    [sessionId, limit]
  );

  return NextResponse.json(result.rows);
}
