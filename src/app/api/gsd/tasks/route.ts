import { NextRequest, NextResponse } from "next/server";
import { getGsdTasks } from "@/lib/gsd-watcher";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project_id");
  const tasks = getGsdTasks(projectId ?? undefined);
  return NextResponse.json(tasks);
}
