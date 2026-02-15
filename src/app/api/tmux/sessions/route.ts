import { NextRequest } from "next/server";
import { getTmuxSessions, tmuxSessionName } from "@/lib/tmux-scanner";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessions = getTmuxSessions();

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (projectId) {
    const name = tmuxSessionName(projectId);
    const filtered = sessions.filter((s) => s.name === name);
    return Response.json(filtered);
  }

  return Response.json(sessions);
}
