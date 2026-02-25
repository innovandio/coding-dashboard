import { NextRequest, NextResponse } from "next/server";
import { homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { getPool } from "@/lib/db";
import { refreshGsdWatchers } from "@/lib/gateway-ingestor";
import { syncGatewayMounts } from "@/lib/agent-scaffold";
import { writeHeartbeatConfig, HeartbeatConfig } from "@/lib/heartbeat-config";
import { setDefaultModel, pasteAuthToken, writeCustomProviderConfig } from "@/lib/model-providers";
import { getValidOpenAIToken } from "@/lib/openai-token-manager";
import { requireAuth } from "@/lib/auth-utils";

const execFileAsync = promisify(execFile);

function expandTilde(p: string): string {
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  if (p === "~") return homedir();
  return p;
}

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    agent_id: string;
    name: string;
    workspace_path: string | null;
    created_at: string;
    meta: Record<string, unknown>;
  }>(`SELECT * FROM projects WHERE id = $1`, [id]);
  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result.rows[0]);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const pool = getPool();

  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (body.name !== undefined) {
    sets.push(`name = $${idx++}`);
    vals.push(body.name);
  }
  if (body.workspace_path !== undefined) {
    sets.push(`workspace_path = $${idx++}`);
    vals.push(expandTilde(body.workspace_path));
  }
  if (body.meta !== undefined) {
    sets.push(`meta = COALESCE(meta, '{}'::jsonb) || $${idx++}::jsonb`);
    vals.push(JSON.stringify(body.meta));
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  vals.push(id);
  await pool.query(`UPDATE projects SET ${sets.join(", ")} WHERE id = $${idx}`, vals);

  // Refresh watchers if workspace_path changed
  if (body.workspace_path !== undefined) {
    refreshGsdWatchers();
    syncGatewayMounts().catch((err) =>
      console.warn("[projects] Failed to sync gateway mounts:", err),
    );
  }

  // Look up agent_id once for heartbeat + model config
  const needsAgentId = body.heartbeat !== undefined || body.meta?.modelConfig;
  let agentId: string | undefined;
  if (needsAgentId) {
    const { rows } = await pool.query<{ agent_id: string }>(
      `SELECT agent_id FROM projects WHERE id = $1`,
      [id],
    );
    agentId = rows[0]?.agent_id;
  }

  // Persist heartbeat config (non-blocking side effect)
  if (body.heartbeat !== undefined && agentId) {
    writeHeartbeatConfig(agentId, body.heartbeat as HeartbeatConfig).catch((err) =>
      console.warn("[projects] Failed to write heartbeat config:", err),
    );
  }

  // Apply model config to gateway agent
  if (body.meta?.modelConfig && agentId) {
    const mc = body.meta.modelConfig;
    try {
      if (mc.mode === "custom") {
        await writeCustomProviderConfig({
          provider: mc.customProvider,
          baseUrl: mc.customBaseUrl,
          api: mc.customApi || "openai-completions",
          modelId: mc.customModelId,
          apiKey: mc.apiKey,
          agentId,
        });
      } else {
        // For OpenAI providers with OAuth, resolve the stored token
        let token = mc.apiKey;
        const providerLower = (mc.provider ?? "").toLowerCase();
        const isOpenAI = providerLower.includes("openai") || providerLower.includes("codex");
        if (isOpenAI && mc.openaiAuthenticated && !token) {
          const session = await requireAuth();
          const userId = session?.user?.id;
          if (userId) {
            token = await getValidOpenAIToken(userId);
          }
        }
        if (token) {
          await pasteAuthToken(mc.provider, token, agentId);
        }
        await setDefaultModel(mc.modelKey, agentId);
      }
    } catch (err) {
      console.warn("[projects] Failed to apply model config:", err);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = getPool();

  // Look up agent_id before deleting the row
  const { rows } = await pool.query<{ agent_id: string }>(
    `SELECT agent_id FROM projects WHERE id = $1`,
    [id],
  );
  const agentId = rows[0]?.agent_id;

  await pool.query(`DELETE FROM sessions WHERE project_id = $1`, [id]);
  await pool.query(`DELETE FROM projects WHERE id = $1`, [id]);

  // Delete the OpenClaw agent from the gateway
  if (agentId) {
    try {
      await execFileAsync("docker", [
        "compose",
        "exec",
        "openclaw-gateway",
        "node",
        "openclaw.mjs",
        "agents",
        "delete",
        agentId,
        "--force",
      ]);
      // Remove session data and agent dir so a recreated agent starts fresh
      await execFileAsync("docker", [
        "compose",
        "exec",
        "-T",
        "openclaw-gateway",
        "sh",
        "-c",
        `rm -rf /root/.openclaw/agents/${agentId} /data/agents/${agentId}`,
      ]);
    } catch (err) {
      console.warn(`[projects] Failed to delete agent ${agentId}:`, err);
    }
  }

  // Refresh GSD watchers to remove the deleted project's watcher
  refreshGsdWatchers();
  syncGatewayMounts().catch((err) =>
    console.warn("[projects] Failed to sync gateway mounts:", err),
  );

  return NextResponse.json({ ok: true });
}
