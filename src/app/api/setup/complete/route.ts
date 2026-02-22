import { runPostSetup } from "@/lib/setup-process";
import { createProgressStream } from "@/lib/ndjson-stream";
import { requireAuth } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireAuth();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { stream, send, close } = createProgressStream();

  (async () => {
    try {
      send({ step: 0, status: "processing", label: "Syncing gateway token" });

      const dashboardUrl = await runPostSetup(
        (step, label) => {
          // Mark previous step as success when a new step starts
          if (step > 0) {
            send({ step: step - 1, status: "success" });
          }
          send({ step, status: "processing", label });
        },
        (url) => {
          // Send dashboard URL mid-stream so the client opens it immediately
          send({ step: 4, status: "processing", data: { dashboardUrl: url } });
        },
        (url) => {
          // Send OAuth URL mid-stream so the client opens it immediately
          send({ step: 2, status: "processing", data: { oauthUrl: url } });
        },
      );

      // Mark final step as success
      send({ step: 4, status: "success" });
      send({ done: true, success: true, data: { dashboardUrl } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[setup/complete] Error:", message);
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
