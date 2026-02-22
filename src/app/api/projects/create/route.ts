import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { cp } from "fs/promises";
import { getPool } from "@/lib/db";
import { refreshGsdWatchers, getIngestorState } from "@/lib/gateway-ingestor";
import { agentDir, scaffoldAgentFiles, syncGatewayMounts } from "@/lib/agent-scaffold";
import { sendGatewayRequest } from "@/lib/gateway-ingestor";
import { createProgressStream } from "@/lib/ndjson-stream";
import { setDefaultModel, pasteAuthToken, writeCustomProviderConfig } from "@/lib/model-providers";
import { writeHeartbeatConfig, HeartbeatConfig } from "@/lib/heartbeat-config";

const execFileAsync = promisify(execFile);

function expandTilde(p: string): string {
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  if (p === "~") return homedir();
  return p;
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { agentId, name, workspace, basedOn, modelConfig, heartbeatConfig } = await req.json();

  if (!agentId || !name || !workspace) {
    return new Response(JSON.stringify({ error: "agentId, name, and workspace are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { stream, send, close } = createProgressStream();

  // Run the multi-step operation async while streaming progress
  (async () => {
    try {
      // Step 0: Register agent
      send({ step: 0, status: "processing", label: "Registering agent" });
      try {
        const containerProjectDir = `/projects/${agentId}`;
        const agentDirPath = agentDir(agentId);
        const runArgs = [
          "compose",
          "run",
          "--rm",
          "-T",
          "-v",
          `${workspace}:${containerProjectDir}`,
          "openclaw-gateway",
        ];

        await execFileAsync("docker", [
          "compose",
          "exec",
          "openclaw-gateway",
          "mkdir",
          "-p",
          agentDirPath,
        ]);

        try {
          await execFileAsync("docker", [
            ...runArgs,
            "openclaw",
            "agents",
            "add",
            agentId,
            "--workspace",
            agentDirPath,
            "--agent-dir",
            agentDirPath,
            "--non-interactive",
          ]);
        } catch (addErr) {
          const msg = addErr instanceof Error ? addErr.message : "";
          if (msg.includes("already exists")) {
            await execFileAsync("docker", [
              ...runArgs,
              "openclaw",
              "agents",
              "delete",
              agentId,
              "--force",
            ]);
            await execFileAsync("docker", [
              ...runArgs,
              "openclaw",
              "agents",
              "add",
              agentId,
              "--workspace",
              agentDirPath,
              "--agent-dir",
              agentDirPath,
              "--non-interactive",
            ]);
          } else {
            throw addErr;
          }
        }

        // Copy from basedOn agent if specified
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

        send({ step: 0, status: "success" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ step: 0, status: "error", error: message });
        send({ done: true, success: false, error: message });
        close();
        return;
      }

      // Step 1: Save project to database
      send({ step: 1, status: "processing", label: "Saving project" });
      try {
        const resolvedPath = expandTilde(workspace);
        const pool = getPool();
        await pool.query(
          `INSERT INTO projects (id, agent_id, name, workspace_path)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET name = $3, workspace_path = $4`,
          [agentId, agentId, name, resolvedPath],
        );
        send({ step: 1, status: "success" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ step: 1, status: "error", error: message });
        send({ done: true, success: false, error: message });
        close();
        return;
      }

      // Step 2: Sync workspace mounts (writes override yml + restarts gateway)
      send({ step: 2, status: "processing", label: "Syncing workspace mounts" });
      try {
        await syncGatewayMounts();
        send({ step: 2, status: "success" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ step: 2, status: "error", error: message });
        send({ done: true, success: false, error: message });
        close();
        return;
      }

      // Step 3: Scaffold agent files
      send({ step: 3, status: "processing", label: "Scaffolding agent files" });
      try {
        await scaffoldAgentFiles({
          projectId: agentId,
          projectName: name,
          force: true,
        });
        send({ step: 3, status: "success" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ step: 3, status: "error", error: message });
        send({ done: true, success: false, error: message });
        close();
        return;
      }

      // Step 4: Configure model (if provided)
      const hasModelConfig =
        modelConfig?.mode === "custom"
          ? !!(modelConfig?.customProvider && modelConfig?.customModelId && modelConfig?.apiKey)
          : !!(modelConfig?.provider && modelConfig?.modelKey && modelConfig?.apiKey);

      if (hasModelConfig) {
        send({ step: 4, status: "processing", label: "Configuring model" });
        try {
          if (modelConfig.mode === "custom") {
            await writeCustomProviderConfig({
              provider: modelConfig.customProvider,
              baseUrl: modelConfig.customBaseUrl,
              api: modelConfig.customApi || "openai-completions",
              modelId: modelConfig.customModelId,
              apiKey: modelConfig.apiKey,
              agentId,
            });
          } else {
            await pasteAuthToken(modelConfig.provider, modelConfig.apiKey, agentId);
            await setDefaultModel(modelConfig.modelKey, agentId);
          }
          send({ step: 4, status: "success" });
        } catch (err) {
          // Non-fatal — project was already created
          const message = err instanceof Error ? err.message : "Unknown error";
          console.warn("[projects/create] Model config error:", message);
          send({ step: 4, status: "success", label: "Configuring model (skipped)" });
        }
      } else {
        // "Use global default" — copy models.json from the main agent so
        // custom provider definitions (base URL, API type) are inherited.
        send({ step: 4, status: "processing", label: "Inheriting global model" });
        try {
          const agentDirPath = agentDir(agentId);
          await execFileAsync("docker", [
            "compose",
            "exec",
            "-T",
            "openclaw-gateway",
            "sh",
            "-c",
            `src="/root/.openclaw/agents/main/agent/models.json"; ` +
              `[ -f "$src" ] && cp "$src" "${agentDirPath}/models.json" && echo "copied" || echo "no-src"`,
          ]);
          send({ step: 4, status: "success" });
        } catch (err) {
          console.warn(
            "[projects/create] Model inherit error:",
            err instanceof Error ? err.message : err,
          );
          send({ step: 4, status: "success", label: "Inheriting global model (skipped)" });
        }
      }

      // Step 5: Configure heartbeat (if provided)
      if (heartbeatConfig && (heartbeatConfig as HeartbeatConfig).enabled) {
        send({ step: 5, status: "processing", label: "Configuring heartbeat" });
        try {
          await writeHeartbeatConfig(agentId, heartbeatConfig as HeartbeatConfig);
          send({ step: 5, status: "success" });
        } catch (err) {
          // Non-fatal — project was already created
          const message = err instanceof Error ? err.message : "Unknown error";
          console.warn("[projects/create] Heartbeat config error:", message);
          send({ step: 5, status: "success", label: "Configuring heartbeat (skipped)" });
        }
      } else {
        send({ step: 5, status: "success", label: "Heartbeat (not configured)" });
      }

      // Step 6: Wait for gateway to reconnect
      send({ step: 6, status: "processing", label: "Waiting for gateway" });
      try {
        refreshGsdWatchers();

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

        if (connected) {
          send({ step: 6, status: "success" });
        } else {
          // Timeout is soft — project was created successfully
          send({ step: 6, status: "success", label: "Gateway still starting (project ready)" });
        }
      } catch (err) {
        // Non-fatal — project exists regardless
        send({ step: 6, status: "success", label: "Waiting for gateway (skipped)" });
        console.warn("[projects/create] Gateway wait error:", err);
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
