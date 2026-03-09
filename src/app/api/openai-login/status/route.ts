import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-utils";
import { hasOpenAITokens } from "@/lib/openai-token-manager";

export const dynamic = "force-dynamic";

/** Check whether the current user has stored OpenAI tokens. */
export async function GET() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user?.id;
  if (!userId) {
    return NextResponse.json({ authenticated: false });
  }

  const authenticated = await hasOpenAITokens(userId);
  return NextResponse.json({ authenticated });
}
