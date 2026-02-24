import { NextRequest, NextResponse } from "next/server";
import { handleOpenAICallback } from "@/lib/openai-login-process";

export const dynamic = "force-dynamic";

/**
 * OAuth callback handler at /auth/callback.
 * This path matches what's registered for the Codex CLI's client_id.
 * Receives ?code=...&state=... from OpenAI's OAuth server
 * after the user authorizes.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/?openai-login=error", req.url));
  }

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const result = await handleOpenAICallback(code, state);

  if (result.ok) {
    return NextResponse.redirect(new URL("/?openai-login=success", req.url));
  }

  console.error("[openai-login] Callback error:", result.error);
  return NextResponse.redirect(new URL("/?openai-login=error", req.url));
}
