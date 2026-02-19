import fs from "fs";
import path from "path";
import {
  getSetupEmitter,
  getSetupState,
  getSetupExitCode,
  getSetupOutputBuffer,
  startSetup,
  resetSetup,
} from "@/lib/setup-process";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cols = Math.max(40, Math.min(200, Number(url.searchParams.get("cols")) || 80));
  const rows = Math.max(10, Math.min(60, Number(url.searchParams.get("rows")) || 24));

  const emitter = getSetupEmitter();
  const encoder = new TextEncoder();

  // If previous run exited but config still missing, reset to allow a fresh run.
  // This handles: user re-opens dialog after a failure, or page reload.
  if (getSetupState() === "exited") {
    const home = process.env.HOME ?? "/root";
    const configExists = fs.existsSync(path.join(home, ".openclaw", "openclaw.json"));
    if (!configExists) {
      resetSetup();
    }
  }

  if (getSetupState() === "idle") {
    startSetup(cols, rows);
  }

  const stream = new ReadableStream({
    start(controller) {
      // Send current state immediately
      const stateMsg = JSON.stringify({
        state: getSetupState(),
        exitCode: getSetupExitCode(),
      });
      try {
        controller.enqueue(encoder.encode(`event: state\ndata: ${stateMsg}\n\n`));
      } catch { /* closed */ }

      // Replay any buffered output (handles React strict-mode double-mount
      // and fast-completing processes)
      for (const chunk of getSetupOutputBuffer()) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ data: chunk })}\n\n`),
          );
        } catch { /* closed */ }
      }

      // If already exited, send exit event immediately
      if (getSetupState() === "exited") {
        try {
          controller.enqueue(
            encoder.encode(
              `event: exit\ndata: ${JSON.stringify({ exitCode: getSetupExitCode() })}\n\n`,
            ),
          );
        } catch { /* closed */ }
      }

      const onData = (data: string) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ data })}\n\n`),
          );
        } catch { /* stream closed */ }
      };

      const onExit = (exitCode: number) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: exit\ndata: ${JSON.stringify({ exitCode })}\n\n`,
            ),
          );
        } catch { /* stream closed */ }
      };

      emitter.on("setup:data", onData);
      emitter.on("setup:exit", onExit);

      // Keepalive every 15s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
        }
      }, 15000);

      req.signal.addEventListener("abort", () => {
        emitter.off("setup:data", onData);
        emitter.off("setup:exit", onExit);
        clearInterval(keepalive);
        try {
          controller.close();
        } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
