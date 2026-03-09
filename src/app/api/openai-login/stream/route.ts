import { auth } from "@/auth";
import {
  getOpenAILoginEmitter,
  getOpenAILoginState,
  getOpenAILoginExitCode,
  getOpenAILoginOAuthUrl,
  startOpenAILogin,
  resetOpenAILogin,
} from "@/lib/openai-login-process";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Try to get userId from session (may fail for SSE/EventSource requests)
  let userId: string | undefined;
  try {
    const session = await auth();
    userId = session?.user?.id ?? undefined;
  } catch {
    /* auth may not work in SSE context */
  }

  // Fall back to query param passed by the client hook
  const reqUrl = new URL(req.url);
  if (!userId) {
    userId = reqUrl.searchParams.get("userId") ?? undefined;
  }

  if (!userId) {
    return new Response("Unauthorized — no user ID", { status: 401 });
  }

  const dashboardOrigin = `http://localhost:${reqUrl.port || "3000"}`;

  const emitter = getOpenAILoginEmitter();
  const encoder = new TextEncoder();

  // Always reset and regenerate PKCE params on each SSE connection
  // so code changes to authorize URL params take effect without restart
  const currentState = getOpenAILoginState();
  if (currentState === "idle" || currentState === "awaiting_auth" || currentState === "exited") {
    resetOpenAILogin();
    startOpenAILogin(dashboardOrigin, userId);
  }

  const stream = new ReadableStream({
    start(controller) {
      const stateMsg = JSON.stringify({
        state: getOpenAILoginState(),
        exitCode: getOpenAILoginExitCode(),
      });
      try {
        controller.enqueue(encoder.encode(`event: state\ndata: ${stateMsg}\n\n`));
      } catch {
        /* closed */
      }

      // Replay OAuth URL if already available
      const oauthUrl = getOpenAILoginOAuthUrl();
      if (oauthUrl) {
        try {
          controller.enqueue(
            encoder.encode(`event: oauth-url\ndata: ${JSON.stringify({ url: oauthUrl })}\n\n`),
          );
        } catch {
          /* closed */
        }
      }

      // If already exited, send exit event immediately
      if (getOpenAILoginState() === "exited") {
        try {
          controller.enqueue(
            encoder.encode(
              `event: exit\ndata: ${JSON.stringify({ exitCode: getOpenAILoginExitCode() })}\n\n`,
            ),
          );
        } catch {
          /* closed */
        }
      }

      const onState = (data: { state: string }) => {
        try {
          controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream closed */
        }
      };

      const onExit = (exitCode: number) => {
        try {
          controller.enqueue(
            encoder.encode(`event: exit\ndata: ${JSON.stringify({ exitCode })}\n\n`),
          );
        } catch {
          /* stream closed */
        }
      };

      const onOAuthUrl = (url: string) => {
        try {
          controller.enqueue(
            encoder.encode(`event: oauth-url\ndata: ${JSON.stringify({ url })}\n\n`),
          );
        } catch {
          /* stream closed */
        }
      };

      emitter.on("openai-login:state", onState);
      emitter.on("openai-login:exit", onExit);
      emitter.on("openai-login:oauth-url", onOAuthUrl);

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
        }
      }, 15000);

      req.signal.addEventListener("abort", () => {
        emitter.off("openai-login:state", onState);
        emitter.off("openai-login:exit", onExit);
        emitter.off("openai-login:oauth-url", onOAuthUrl);
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
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
