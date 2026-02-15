import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { parseGsdFiles } from "@/lib/gsd-parser";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { project_id } = body;

  if (!project_id) {
    return NextResponse.json(
      { error: "project_id is required" },
      { status: 400 }
    );
  }

  const pool = getPool();
  const project = await pool.query(
    `SELECT * FROM projects WHERE id = $1`,
    [project_id]
  );

  if (project.rows.length === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const workspacePath = project.rows[0].workspace_path;
  if (!workspacePath) {
    return NextResponse.json(
      { error: "Project has no workspace_path configured" },
      { status: 400 }
    );
  }

  const tasks = await parseGsdFiles(workspacePath, project_id);

  // Upsert tasks
  const taskIds: string[] = [];
  for (const task of tasks) {
    taskIds.push(task.id);
    await pool.query(
      `INSERT INTO gsd_tasks (id, project_id, title, status, wave, file_path, meta, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id) DO UPDATE SET
         title = $3, status = $4, wave = $5, file_path = $6, meta = $7, updated_at = now()`,
      [task.id, task.project_id, task.title, task.status, task.wave, task.file_path, JSON.stringify(task.meta)]
    );
  }

  // Delete tasks that no longer exist in the files
  if (taskIds.length > 0) {
    await pool.query(
      `DELETE FROM gsd_tasks WHERE project_id = $1 AND id != ALL($2)`,
      [project_id, taskIds]
    );
  } else {
    await pool.query(
      `DELETE FROM gsd_tasks WHERE project_id = $1`,
      [project_id]
    );
  }

  return NextResponse.json({ ok: true, count: tasks.length });
}
