"use client";

import { useEffect, useState } from "react";

export type LoginStreamState = "idle" | "awaiting_auth" | "exchanging" | "exited";

/**
 * Hook that connects to the /api/claude-login/stream SSE endpoint.
 * Tracks login state, exit code, and the extracted OAuth URL.
 *
 * The flow is now fully browser-redirect based:
 * 1. SSE stream starts → server generates PKCE + OAuth URL
 * 2. User clicks "Sign in" → opens OAuth URL in new tab
 * 3. After authorization, browser redirects to /api/claude-login/callback
 * 4. Server exchanges code for tokens, writes credentials to container
 * 5. SSE stream emits exit event with success/failure
 */
export function useClaudeLoginStream(enabled: boolean) {
  const [loginState, setLoginState] = useState<LoginStreamState>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [oauthUrl, setOAuthUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoginState("idle");
      setExitCode(null);
      setOAuthUrl(null);
      return;
    }

    const es = new EventSource("/api/claude-login/stream");

    es.addEventListener("state", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.state) setLoginState(payload.state);
        if (typeof payload.exitCode === "number") setExitCode(payload.exitCode);
      } catch { /* ignore */ }
    });

    es.addEventListener("oauth-url", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.url) setOAuthUrl(payload.url);
      } catch { /* ignore */ }
    });

    es.addEventListener("exit", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        setLoginState("exited");
        setExitCode(payload.exitCode ?? 1);
      } catch { /* ignore */ }
    });

    return () => es.close();
  }, [enabled]);

  return { loginState, exitCode, oauthUrl };
}
