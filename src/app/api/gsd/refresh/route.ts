import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { refreshProjectTasks } from "@/lib/gsd-watcher";
import { requireAuth } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { project_id } = body;

  if (!project_id) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  const pool = getPool();
  const project = await pool.query(`SELECT * FROM projects WHERE id = $1`, [project_id]);

  if (project.rows.length === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const workspacePath = project.rows[0].workspace_path;
  if (!workspacePath) {
    return NextResponse.json(
      { error: "Project has no workspace_path configured" },
      { status: 400 },
    );
  }

  const tasks = await refreshProjectTasks(project_id, workspacePath);
  return NextResponse.json({ ok: true, count: tasks.length });
}
