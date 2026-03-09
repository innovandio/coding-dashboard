"use client";

import { useEffect, useState } from "react";

export type OpenAILoginStreamState = "idle" | "awaiting_auth" | "exchanging" | "exited";

/**
 * Hook that connects to the /api/openai-login/stream SSE endpoint.
 * Tracks login state, exit code, and the extracted OAuth URL.
 *
 * Flow mirrors use-claude-login-stream.ts but targets OpenAI OAuth:
 * 1. SSE stream starts → server generates PKCE + OAuth URL
 * 2. User clicks "Sign in" → opens OAuth URL in new tab
 * 3. After authorization, browser redirects to /openai-callback
 * 4. Server exchanges code for tokens, stores in PostgreSQL
 * 5. SSE stream emits exit event with success/failure
 */
export function useOpenAILoginStream(enabled: boolean) {
  const [loginState, setLoginState] = useState<OpenAILoginStreamState>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [oauthUrl, setOAuthUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoginState("idle");
      setExitCode(null);
      setOAuthUrl(null);
      return;
    }

    const es = new EventSource("/api/openai-login/stream");

    es.addEventListener("state", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.state) setLoginState(payload.state);
        if (typeof payload.exitCode === "number") setExitCode(payload.exitCode);
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("oauth-url", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.url) setOAuthUrl(payload.url);
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("exit", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        setLoginState("exited");
        setExitCode(payload.exitCode ?? 1);
      } catch {
        /* ignore */
      }
    });

    return () => es.close();
  }, [enabled]);

  return { loginState, exitCode, oauthUrl };
}
