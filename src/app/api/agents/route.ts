import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { cp } from "fs/promises";
import { agentDir } from "@/lib/agent-scaffold";
import { sendGatewayRequest } from "@/lib/gateway-ingestor";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

/** GET /api/agents — list OpenClaw agents via gateway API */
export async function GET() {
  try {
    const payload = await sendGatewayRequest("agents.list");
    const agents = (payload as { agents?: unknown[] }).agents ?? [];
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
    // Create the agent via docker compose run with the workspace bind-mounted.
    // We use `run --rm` instead of `exec` because the running container only
    // mounts ~/.openclaw and /data/agents — the host workspace path isn't
    // available inside it. Mount it at /projects/<agentId> for file access.
    const containerProjectDir = `/projects/${agentId}`;
    const agentDirPath = agentDir(agentId);
    const runArgs = [
      "compose", "run", "--rm", "-T",
      "-v", `${workspace}:${containerProjectDir}`,
      "openclaw-gateway",
    ];

    // Pre-create the agent directory as root in the running container since the
    // agentdata volume root is owned by root and the process runs as node.
    await execFileAsync("docker", [
      "compose", "exec", "-u", "root", "openclaw-gateway",
      "sh", "-c", `mkdir -p ${agentDirPath} && chown node:node ${agentDirPath}`,
    ]);

    try {
      await execFileAsync("docker", [
        ...runArgs,
        "node", "openclaw.mjs", "agents", "add", agentId,
        "--workspace", agentDirPath,
        "--agent-dir", agentDirPath,
        "--non-interactive",
      ]);
    } catch (addErr) {
      const msg = addErr instanceof Error ? addErr.message : "";
      if (msg.includes("already exists")) {
        // Delete stale agent and re-add with the correct paths
        await execFileAsync("docker", [
          ...runArgs,
          "node", "openclaw.mjs", "agents", "delete", agentId, "--force",
        ]);
        await execFileAsync("docker", [
          ...runArgs,
          "node", "openclaw.mjs", "agents", "add", agentId,
          "--workspace", agentDirPath,
          "--agent-dir", agentDirPath,
          "--non-interactive",
        ]);
      } else {
        throw addErr;
      }
    }

    // If based on an existing agent, copy its agent-dir contents
    if (basedOn) {
      const payload = await sendGatewayRequest("agents.list");
      const agents = ((payload as { agents?: unknown[] }).agents ?? []) as Array<{
        id: string;
        agentDir: string;
        workspace: string;
      }>;
      const source = agents.find((a) => a.id === basedOn);
      const target = agents.find((a) => a.id === agentId);

      if (source && target) {
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
