import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("project_id");
  const sessionId = sp.get("session_id");
  const afterId = sp.get("after_id");
  const eventType = sp.get("event_type");
  const limit = Math.min(parseInt(sp.get("limit") ?? "100", 10), 500);

  const conditions: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (projectId) {
    conditions.push(`project_id = $${idx++}`);
    vals.push(projectId);
  }
  if (sessionId) {
    conditions.push(`session_id = $${idx++}`);
    vals.push(sessionId);
  }
  if (afterId) {
    conditions.push(`id > $${idx++}`);
    vals.push(afterId);
  }
  if (eventType) {
    conditions.push(`event_type = $${idx++}`);
    vals.push(eventType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  vals.push(limit);

  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM events ${where} ORDER BY id DESC LIMIT $${idx}`,
    vals
  );

  return NextResponse.json(result.rows);
}
