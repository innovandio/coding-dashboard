import { NextRequest, NextResponse } from "next/server";
import { handleCallback } from "@/lib/claude-login-process";

export const dynamic = "force-dynamic";

/**
 * OAuth callback handler at /callback.
 * The redirect_uri registered with Anthropic's OAuth server is
 * http://localhost:{PORT}/callback — so this must live at exactly /callback.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/?login=error", req.url));
  }

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const result = await handleCallback(code, state);

  if (result.ok) {
    return NextResponse.redirect(new URL("/?login=success", req.url));
  }

  console.error("[claude-login] Callback error:", result.error);
  return NextResponse.redirect(new URL("/?login=error", req.url));
}
