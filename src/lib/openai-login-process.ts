/**
 * Server-side module that manages OpenAI OAuth login via PKCE.
 *
 * Mirrors claude-login-process.ts but targets OpenAI's OAuth endpoints
 * and stores tokens in PostgreSQL (encrypted) instead of a Docker container file.
 *
 * Flow:
 * 1. Generate code_verifier + code_challenge (S256)
 * 2. Build auth URL pointing to auth.openai.com with redirect to /openai-callback
 * 3. User authorizes in browser → redirected to /openai-callback
 * 4. Exchange authorization code for tokens at auth.openai.com
 * 5. Store encrypted tokens in openai_tokens table
 */
import { randomBytes, createHash } from "crypto";
import { createServer, type Server } from "http";
import { EventEmitter } from "events";
import { storeOpenAITokens } from "./openai-token-manager";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const SCOPES = "openid profile email offline_access";
const CALLBACK_PORT = 1455;
const CALLBACK_REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;

export type OpenAILoginState = "idle" | "awaiting_auth" | "exchanging" | "exited";

interface OpenAILoginSession {
  state: OpenAILoginState;
  exitCode: number | null;
  oauthUrl: string | null;
  codeVerifier: string;
  stateParam: string;
  redirectUri: string;
  dashboardOrigin: string;
  userId: string | null;
  emitter: EventEmitter;
  callbackServer: Server | null;
}

const globalForLogin = globalThis as unknown as { openaiLoginSession?: OpenAILoginSession };

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateCodeVerifier(): string {
  // Use 64 bytes to match Codex CLI (pkce.rs: [0u8; 64]) → 86-char verifier
  return base64url(randomBytes(64));
}

function generateCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

function generateState(): string {
  return base64url(randomBytes(32));
}

function getSession(): OpenAILoginSession {
  if (!globalForLogin.openaiLoginSession) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    globalForLogin.openaiLoginSession = {
      state: "idle",
      exitCode: null,
      oauthUrl: null,
      codeVerifier: "",
      stateParam: "",
      redirectUri: "",
      dashboardOrigin: "",
      userId: null,
      emitter,
      callbackServer: null,
    };
  }
  return globalForLogin.openaiLoginSession;
}

export function getOpenAILoginEmitter(): EventEmitter {
  return getSession().emitter;
}

export function getOpenAILoginState(): OpenAILoginState {
  return getSession().state;
}

export function getOpenAILoginExitCode(): number | null {
  return getSession().exitCode;
}

export function getOpenAILoginOAuthUrl(): string | null {
  return getSession().oauthUrl;
}

/**
 * Start a new OpenAI OAuth login flow.
 * Generates PKCE parameters, builds the authorization URL,
 * and starts a temporary HTTP server on port 1455 to receive the callback
 * (OpenAI only allows localhost:1455 as a redirect_uri for this client_id).
 */
export function startOpenAILogin(dashboardOrigin: string, userId: string): void {
  const session = getSession();
  if (session.state === "awaiting_auth" || session.state === "exchanging") return;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const stateParam = generateState();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", CALLBACK_REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", stateParam);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "codex_cli_rs");

  session.codeVerifier = codeVerifier;
  session.stateParam = stateParam;
  session.redirectUri = CALLBACK_REDIRECT_URI;
  session.dashboardOrigin = dashboardOrigin;
  session.userId = userId;
  session.oauthUrl = url.toString();
  session.state = "awaiting_auth";
  session.exitCode = null;

  // Start temp callback server on port 1455
  startCallbackServer(session);

  console.log("[openai-login] OAuth flow started, awaiting authorization");
  session.emitter.emit("openai-login:oauth-url", session.oauthUrl);
  session.emitter.emit("openai-login:state", { state: session.state });
}

/**
 * Starts a temporary HTTP server on port 1455 to receive the OAuth callback.
 * After receiving the callback, exchanges the code for tokens and redirects
 * the browser back to the dashboard.
 */
function startCallbackServer(session: OpenAILoginSession): void {
  if (session.callbackServer) {
    session.callbackServer.close();
    session.callbackServer = null;
  }

  const server = createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);

    if (reqUrl.pathname !== "/auth/callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const code = reqUrl.searchParams.get("code");
    const state = reqUrl.searchParams.get("state");
    const error = reqUrl.searchParams.get("error");

    const sendAutoClosePage = (title: string, message: string) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><head><title>${title}</title></head><body>
        <p>${message}</p>
        <script>window.close();</script>
      </body></html>`);
    };

    if (error) {
      sendAutoClosePage("Login Failed", "Authentication failed. You can close this tab.");
      shutdownCallbackServer(session);
      return;
    }

    if (!code || !state) {
      res.writeHead(400);
      res.end("Missing code or state");
      return;
    }

    const result = await handleOpenAICallback(code, state);

    if (result.ok) {
      sendAutoClosePage(
        "Login Successful",
        "Signed in with OpenAI. This tab will close automatically.",
      );
    } else {
      console.error("[openai-login] Callback error:", result.error);
      sendAutoClosePage("Login Failed", "Token exchange failed. You can close this tab.");
    }
    shutdownCallbackServer(session);
  });

  server.listen(CALLBACK_PORT, "127.0.0.1", () => {
    console.log(`[openai-login] Callback server listening on port ${CALLBACK_PORT}`);
  });

  server.on("error", (err) => {
    console.error(`[openai-login] Failed to start callback server on port ${CALLBACK_PORT}:`, err);
    session.callbackServer = null;
  });

  session.callbackServer = server;
}

function shutdownCallbackServer(session: OpenAILoginSession): void {
  if (session.callbackServer) {
    session.callbackServer.close();
    session.callbackServer = null;
    console.log("[openai-login] Callback server shut down");
  }
}

/**
 * Handle the OAuth callback: validate state, exchange code for tokens,
 * store encrypted tokens in PostgreSQL.
 */
export async function handleOpenAICallback(
  code: string,
  state: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = getSession();

  if (session.state !== "awaiting_auth") {
    return { ok: false, error: "Not awaiting authorization" };
  }

  if (state !== session.stateParam) {
    return { ok: false, error: "State mismatch" };
  }

  if (!session.userId) {
    return { ok: false, error: "No user ID associated with login session" };
  }

  session.state = "exchanging";
  session.emitter.emit("openai-login:state", { state: session.state });

  try {
    // Use form-encoded body to match Codex CLI (server.rs: exchange_code_for_tokens)
    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: session.redirectUri,
        client_id: CLIENT_ID,
        code_verifier: session.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      throw new Error(`Token exchange failed (${tokenResponse.status}): ${text}`);
    }

    const tokens = await tokenResponse.json();

    await storeOpenAITokens(session.userId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token ?? null,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    });

    console.log("[openai-login] Tokens stored successfully");

    session.state = "exited";
    session.exitCode = 0;
    session.emitter.emit("openai-login:exit", 0);

    return { ok: true };
  } catch (err) {
    console.error("[openai-login] OAuth exchange failed:", err);
    session.state = "exited";
    session.exitCode = 1;
    session.emitter.emit("openai-login:exit", 1);
    return { ok: false, error: String(err) };
  }
}

/** Reset so the login can be re-run. */
export function resetOpenAILogin(): void {
  const session = getSession();
  shutdownCallbackServer(session);
  session.state = "idle";
  session.exitCode = null;
  session.oauthUrl = null;
  session.codeVerifier = "";
  session.stateParam = "";
  session.dashboardOrigin = "";
  session.userId = null;
}
