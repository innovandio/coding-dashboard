/**
 * Manages OpenAI OAuth tokens in PostgreSQL with pgcrypto encryption.
 *
 * Tokens are encrypted at rest using pgp_sym_encrypt/pgp_sym_decrypt
 * with a symmetric key from the OPENAI_TOKEN_ENCRYPTION_KEY env var.
 */
import { getPool } from "./db";

function getEncryptionKey(): string {
  const key = process.env.OPENAI_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("OPENAI_TOKEN_ENCRYPTION_KEY is not set");
  return key;
}

export interface OpenAITokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string | null;
  expiresAt: Date;
}

/** Store (upsert) OpenAI tokens for a user, encrypted at rest. */
export async function storeOpenAITokens(userId: string, tokens: OpenAITokens): Promise<void> {
  const pool = getPool();
  const key = getEncryptionKey();

  await pool.query(
    `INSERT INTO openai_tokens (user_id, access_token, refresh_token, id_token, expires_at)
     VALUES ($1, pgp_sym_encrypt($2, $5), pgp_sym_encrypt($3, $5), $4, $6)
     ON CONFLICT (user_id)
     DO UPDATE SET
       access_token  = pgp_sym_encrypt($2, $5),
       refresh_token = pgp_sym_encrypt($3, $5),
       id_token      = $4,
       expires_at    = $6,
       updated_at    = now()`,
    [
      userId,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.idToken ?? null,
      key,
      tokens.expiresAt,
    ],
  );
}

/** Retrieve decrypted OpenAI tokens for a user. Returns null if not found. */
export async function getOpenAITokens(userId: string): Promise<OpenAITokens | null> {
  const pool = getPool();
  const key = getEncryptionKey();

  const { rows } = await pool.query(
    `SELECT
       pgp_sym_decrypt(access_token, $2)  AS access_token,
       pgp_sym_decrypt(refresh_token, $2) AS refresh_token,
       id_token,
       expires_at
     FROM openai_tokens
     WHERE user_id = $1`,
    [userId, key],
  );

  if (rows.length === 0) return null;

  return {
    accessToken: rows[0].access_token,
    refreshToken: rows[0].refresh_token,
    idToken: rows[0].id_token,
    expiresAt: new Date(rows[0].expires_at),
  };
}

/** Check whether a user has stored OpenAI tokens. */
export async function hasOpenAITokens(userId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT 1 FROM openai_tokens WHERE user_id = $1 LIMIT 1", [
    userId,
  ]);
  return rows.length > 0;
}

/** Delete OpenAI tokens for a user. */
export async function deleteOpenAITokens(userId: string): Promise<void> {
  const pool = getPool();
  await pool.query("DELETE FROM openai_tokens WHERE user_id = $1", [userId]);
}

const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/**
 * Refresh the access token using the stored refresh_token.
 * Updates the DB with the new tokens and returns them.
 */
export async function refreshOpenAIToken(userId: string): Promise<OpenAITokens> {
  const existing = await getOpenAITokens(userId);
  if (!existing) throw new Error("No OpenAI tokens found for user");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: existing.refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI token refresh failed (${response.status}): ${text}`);
  }

  const data = await response.json();

  const tokens: OpenAITokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? existing.refreshToken,
    idToken: data.id_token ?? existing.idToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };

  await storeOpenAITokens(userId, tokens);
  return tokens;
}

/**
 * Get a valid access token, refreshing if expired.
 * Returns the access_token string ready for API use.
 */
export async function getValidOpenAIToken(userId: string): Promise<string> {
  const tokens = await getOpenAITokens(userId);
  if (!tokens) throw new Error("No OpenAI tokens found for user");

  // Refresh if token expires within 5 minutes
  if (tokens.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    const refreshed = await refreshOpenAIToken(userId);
    return refreshed.accessToken;
  }

  return tokens.accessToken;
}
