import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { cp } from "fs/promises";
import { agentDir } from "@/lib/agent-scaffold";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

/** GET /api/agents — list OpenClaw agents */
export async function GET() {
  try {
    const { stdout } = await execFileAsync("openclaw", [
      "agents",
      "list",
      "--json",
    ]);
    const agents = JSON.parse(stdout);
    return NextResponse.json(agents);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST /api/agents — create a new OpenClaw agent, optionally based on another */
export async function POST(req: NextRequest) {
  const { agentId, workspace, basedOn } = await req.json();

  if (!agentId || !workspace) {
    return NextResponse.json(
      { error: "agentId and workspace are required" },
      { status: 400 }
    );
  }

  try {
    // Create the agent via CLI, storing agent state inside the workspace
    await execFileAsync("openclaw", [
      "agents",
      "add",
      agentId,
      "--workspace",
      workspace,
      "--agent-dir",
      agentDir(workspace),
      "--non-interactive",
    ]);

    // If based on an existing agent, copy its agent-dir contents
    if (basedOn) {
      const { stdout } = await execFileAsync("openclaw", [
        "agents",
        "list",
        "--json",
      ]);
      const agents = JSON.parse(stdout) as Array<{
        id: string;
        agentDir: string;
        workspace: string;
      }>;
      const source = agents.find((a) => a.id === basedOn);
      const target = agents.find((a) => a.id === agentId);

      if (source && target) {
        // Copy agent files (identity, soul, etc.) — agentDir is inside the workspace
        await cp(source.agentDir, target.agentDir, {
          recursive: true,
          force: true,
        });
      }
    }

    return NextResponse.json({ ok: true, agentId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
