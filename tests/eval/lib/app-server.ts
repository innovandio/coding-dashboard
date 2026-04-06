import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createServer } from "net";

export interface AppServerHandle {
  baseUrl: string;
  port: number;
  stop: () => Promise<void>;
}

interface StartAppServerOptions {
  workspacePath: string;
  healthPath?: string;
  startupTimeoutMs?: number;
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate local port"));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(
  baseUrl: string,
  healthPath: string,
  timeoutMs: number,
  child: ChildProcessWithoutNullStreams,
  logs: string[],
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(
        `App server exited early with code ${child.exitCode}. Recent logs:\n${logs.join("")}`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}${healthPath}`);
      if (response.ok) return;
    } catch {
      // Retry until timeout.
    }

    await sleep(1000);
  }

  throw new Error(
    `App server readiness probe timed out after ${timeoutMs}ms. Recent logs:\n${logs.join("")}`,
  );
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode != null) return;

  child.kill("SIGTERM");

  const timeoutMs = 10_000;
  const start = Date.now();
  while (child.exitCode == null && Date.now() - start < timeoutMs) {
    await sleep(100);
  }

  if (child.exitCode == null) {
    child.kill("SIGKILL");
  }
}

export async function startAppServer(options: StartAppServerOptions): Promise<AppServerHandle> {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const healthPath = options.healthPath ?? "/api/health";
  const startupTimeoutMs = options.startupTimeoutMs ?? 120_000;

  const child = spawn(
    "pnpm",
    ["exec", "next", "dev", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: options.workspacePath,
      env: {
        ...process.env,
        NODE_ENV: "development",
      },
      stdio: "pipe",
    },
  );

  const recentLogs: string[] = [];
  const appendLog = (chunk: string) => {
    recentLogs.push(chunk);
    while (recentLogs.length > 30) recentLogs.shift();
  };

  child.stdout.on("data", (data: Buffer) => appendLog(data.toString("utf-8")));
  child.stderr.on("data", (data: Buffer) => appendLog(data.toString("utf-8")));

  await waitForReady(baseUrl, healthPath, startupTimeoutMs, child, recentLogs);

  return {
    baseUrl,
    port,
    async stop() {
      await stopChild(child);
    },
  };
}
