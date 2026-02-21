/**
 * Server-side module that manages Claude Code OAuth login.
 *
 * Instead of running `claude auth login` interactively (which has
 * stdin/PTY/redirect_uri issues in a Docker container), we implement
 * the OAuth2 PKCE flow ourselves:
 *
 * 1. Generate code_verifier + code_challenge (S256)
 * 2. Build auth URL pointing to claude.ai with redirect back to our Next.js server
 * 3. User authorizes in the browser → redirected to /api/claude-login/callback
 * 4. Exchange the authorization code for tokens at platform.claude.com
 * 5. Write credentials file into the container
 */
import { randomBytes, createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { EventEmitter } from "events";
import { invalidateNeedsClaudeLoginCache } from "./gateway-ingestor";

const execFileAsync = promisify(execFile);

// Claude Code OAuth constants (from the CLI binary)
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const SCOPES = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers";

export type LoginState = "idle" | "awaiting_auth" | "exchanging" | "exited";

interface LoginSession {
  state: LoginState;
  exitCode: number | null;
  oauthUrl: string | null;
  codeVerifier: string;
  stateParam: string;
  redirectUri: string;
  emitter: EventEmitter;
}

const globalForLogin = globalThis as unknown as { loginSession?: LoginSession };

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

function generateState(): string {
  return base64url(randomBytes(32));
}

function getSession(): LoginSession {
  if (!globalForLogin.loginSession) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    globalForLogin.loginSession = {
      state: "idle",
      exitCode: null,
      oauthUrl: null,
      codeVerifier: "",
      stateParam: "",
      redirectUri: "",
      emitter,
    };
  }
  return globalForLogin.loginSession;
}

export function getLoginEmitter(): EventEmitter {
  return getSession().emitter;
}

export function getLoginState(): LoginState {
  return getSession().state;
}

export function getLoginExitCode(): number | null {
  return getSession().exitCode;
}

export function getLoginOAuthUrl(): string | null {
  return getSession().oauthUrl;
}

/**
 * Start a new OAuth login flow.
 * Generates PKCE parameters and builds the authorization URL.
 * The redirectUri should be the full URL to our callback handler
 * (e.g., "http://localhost:3000/api/claude-login/callback").
 */
export function startLogin(redirectUri: string): void {
  const session = getSession();
  if (session.state === "awaiting_auth" || session.state === "exchanging") return;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const stateParam = generateState();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", stateParam);

  session.codeVerifier = codeVerifier;
  session.stateParam = stateParam;
  session.redirectUri = redirectUri;
  session.oauthUrl = url.toString();
  session.state = "awaiting_auth";
  session.exitCode = null;

  console.log("[claude-login] OAuth flow started, awaiting authorization");
  session.emitter.emit("login:oauth-url", session.oauthUrl);
  session.emitter.emit("login:state", { state: session.state });
}

/**
 * Handle the OAuth callback: validate state, exchange code for tokens,
 * write credentials into the container.
 */
export async function handleCallback(
  code: string,
  state: string,
): Promise<{ ok: boolean; error?: string; redirect?: string }> {
  const session = getSession();

  if (session.state !== "awaiting_auth") {
    return { ok: false, error: "Not awaiting authorization" };
  }

  if (state !== session.stateParam) {
    return { ok: false, error: "State mismatch" };
  }

  session.state = "exchanging";
  session.emitter.emit("login:state", { state: session.state });

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: session.redirectUri,
        client_id: CLIENT_ID,
        code_verifier: session.codeVerifier,
        state,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      throw new Error(`Token exchange failed (${tokenResponse.status}): ${text}`);
    }

    const tokens = await tokenResponse.json();
    // tokens: { access_token, refresh_token, expires_in, scope, account?, organization? }

    // Build the credentials object in the format Claude Code expects.
    // The CLI stores OAuth tokens under a "claudeAiOauth" key inside
    // the .credentials.json file.
    const credentials = {
      claudeAiOauth: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        scopes: tokens.scope?.split(" ").filter(Boolean) ?? [],
        subscriptionType: null,
        rateLimitTier: null,
      },
    };

    // Write credentials into the container
    const credJson = JSON.stringify(credentials);
    await execFileAsync("docker", [
      "compose", "exec", "-T", "openclaw-gateway",
      "sh", "-c",
      `mkdir -p "$HOME/.claude" && cat > "$HOME/.claude/.credentials.json" << 'CREDENTIALS_EOF'
${credJson}
CREDENTIALS_EOF
chmod 600 "$HOME/.claude/.credentials.json"`,
    ]);

    console.log("[claude-login] Credentials written successfully");

    session.state = "exited";
    session.exitCode = 0;
    session.emitter.emit("login:exit", 0);
    invalidateNeedsClaudeLoginCache();

    return { ok: true };
  } catch (err) {
    console.error("[claude-login] OAuth exchange failed:", err);
    session.state = "exited";
    session.exitCode = 1;
    session.emitter.emit("login:exit", 1);
    return { ok: false, error: String(err) };
  }
}

/** Reset so the login can be re-run. */
export function resetLogin(): void {
  const session = getSession();
  session.state = "idle";
  session.exitCode = null;
  session.oauthUrl = null;
  session.codeVerifier = "";
  session.stateParam = "";
}

// Legacy exports for compatibility with existing stream route
export function getLoginOutputBuffer(): string[] {
  return [];
}

export function isLoginOrphaned(): boolean {
  return false;
}

export function writeLoginInput(_data: string): void {
  // No-op: stdin-based input is no longer used
}

export function submitOAuthCode(_code: string): { ok: boolean; error?: string } {
  return { ok: false, error: "Use the callback-based flow instead" };
}
