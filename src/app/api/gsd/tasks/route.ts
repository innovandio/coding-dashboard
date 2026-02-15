import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project_id");

  const pool = getPool();

  let result;
  if (projectId) {
    result = await pool.query(
      `SELECT * FROM gsd_tasks WHERE project_id = $1 ORDER BY wave NULLS LAST, title`,
      [projectId]
    );
  } else {
    result = await pool.query(
      `SELECT * FROM gsd_tasks ORDER BY project_id, wave NULLS LAST, title`
    );
  }

  return NextResponse.json(result.rows);
}
