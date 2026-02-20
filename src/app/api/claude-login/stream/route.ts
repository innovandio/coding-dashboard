import {
  getLoginEmitter,
  getLoginState,
  getLoginExitCode,
  getLoginOAuthUrl,
  startLogin,
  resetLogin,
} from "@/lib/claude-login-process";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Build the redirect URI from the request URL (same origin)
  const reqUrl = new URL(req.url);
  // Must be http://localhost:{PORT}/callback — this is the pattern Anthropic's
  // OAuth server allows for native app PKCE flows.
  const redirectUri = `http://localhost:${reqUrl.port || "3000"}/callback`;

  const emitter = getLoginEmitter();
  const encoder = new TextEncoder();

  // Reset stale state so we can start fresh
  const currentUrl = getLoginOAuthUrl();
  const redirectMismatch = currentUrl && !currentUrl.includes(encodeURIComponent(redirectUri));
  if (getLoginState() === "exited" || redirectMismatch) {
    resetLogin();
  }

  if (getLoginState() === "idle") {
    startLogin(redirectUri);
  }

  const stream = new ReadableStream({
    start(controller) {
      const stateMsg = JSON.stringify({
        state: getLoginState(),
        exitCode: getLoginExitCode(),
      });
      try {
        controller.enqueue(encoder.encode(`event: state\ndata: ${stateMsg}\n\n`));
      } catch { /* closed */ }

      // Replay OAuth URL if already available
      const oauthUrl = getLoginOAuthUrl();
      if (oauthUrl) {
        try {
          controller.enqueue(
            encoder.encode(`event: oauth-url\ndata: ${JSON.stringify({ url: oauthUrl })}\n\n`),
          );
        } catch { /* closed */ }
      }

      // If already exited, send exit event immediately
      if (getLoginState() === "exited") {
        try {
          controller.enqueue(
            encoder.encode(
              `event: exit\ndata: ${JSON.stringify({ exitCode: getLoginExitCode() })}\n\n`,
            ),
          );
        } catch { /* closed */ }
      }

      const onState = (data: { state: string }) => {
        try {
          controller.enqueue(
            encoder.encode(`event: state\ndata: ${JSON.stringify(data)}\n\n`),
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

      const onOAuthUrl = (url: string) => {
        try {
          controller.enqueue(
            encoder.encode(`event: oauth-url\ndata: ${JSON.stringify({ url })}\n\n`),
          );
        } catch { /* stream closed */ }
      };

      emitter.on("login:state", onState);
      emitter.on("login:exit", onExit);
      emitter.on("login:oauth-url", onOAuthUrl);

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
        }
      }, 15000);

      req.signal.addEventListener("abort", () => {
        emitter.off("login:state", onState);
        emitter.off("login:exit", onExit);
        emitter.off("login:oauth-url", onOAuthUrl);
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
