import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getPool } from "@/lib/db";
import { refreshGsdWatchers, getIngestorState } from "@/lib/gateway-ingestor";
import { syncGatewayMounts } from "@/lib/agent-scaffold";
import { createProgressStream } from "@/lib/ndjson-stream";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { stream, send, close } = createProgressStream();

  (async () => {
    try {
      const pool = getPool();

      // Look up agent_id before deleting the row
      const { rows } = await pool.query<{ agent_id: string }>(
        `SELECT agent_id FROM projects WHERE id = $1`,
        [id],
      );
      const agentId = rows[0]?.agent_id;

      if (!agentId) {
        send({ step: 0, status: "error", label: "Removing sessions", error: "Project not found" });
        send({ done: true, success: false, error: "Project not found" });
        close();
        return;
      }

      // Step 0: Remove sessions
      send({ step: 0, status: "processing", label: "Removing sessions" });
      try {
        await pool.query(`DELETE FROM sessions WHERE project_id = $1`, [id]);
        send({ step: 0, status: "success" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ step: 0, status: "error", error: message });
        send({ done: true, success: false, error: message });
        close();
        return;
      }

      // Step 1: Remove project record
      send({ step: 1, status: "processing", label: "Removing project record" });
      try {
        await pool.query(`DELETE FROM projects WHERE id = $1`, [id]);
        send({ step: 1, status: "success" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ step: 1, status: "error", error: message });
        send({ done: true, success: false, error: message });
        close();
        return;
      }

      // Step 2: Delete agent from gateway
      send({ step: 2, status: "processing", label: "Deleting agent from gateway" });
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
        send({ step: 2, status: "success" });
      } catch (err) {
        // Non-fatal — DB records are already gone
        console.warn(`[projects/delete] Failed to delete agent ${agentId}:`, err);
        send({ step: 2, status: "success", label: "Deleting agent from gateway (skipped)" });
      }

      // Step 3: Sync gateway mounts
      send({ step: 3, status: "processing", label: "Syncing gateway mounts" });
      try {
        refreshGsdWatchers();
        await syncGatewayMounts();
        send({ step: 3, status: "success" });
      } catch (err) {
        // Non-fatal — project is deleted regardless
        console.warn("[projects/delete] Failed to sync gateway mounts:", err);
        send({ step: 3, status: "success", label: "Syncing gateway mounts (skipped)" });
      }

      // Step 4: Wait for gateway to reconnect
      send({ step: 4, status: "processing", label: "Waiting for gateway" });
      try {
        const deadline = Date.now() + 60_000;
        let connected = false;
        while (Date.now() < deadline) {
          const state = getIngestorState();
          if (state.connectionState === "connected") {
            connected = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        send({
          step: 4,
          status: "success",
          label: connected ? "Gateway connected" : "Gateway still starting (project deleted)",
        });
      } catch {
        send({ step: 4, status: "success", label: "Waiting for gateway (skipped)" });
      }

      send({ done: true, success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      send({ done: true, success: false, error: message });
    } finally {
      close();
    }
  })();

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
