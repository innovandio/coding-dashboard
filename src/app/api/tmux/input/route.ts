import { NextRequest, NextResponse } from "next/server";
import { sendTmuxKeys } from "@/lib/tmux-scanner";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { session, keys, literal } = await req.json();

  if (!session || !keys) {
    return NextResponse.json({ error: "session and keys required" }, { status: 400 });
  }

  try {
    await sendTmuxKeys(session, keys, literal ?? false);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[tmux/input] Failed to send keys:", err);
    return NextResponse.json({ error: "Failed to send keys" }, { status: 500 });
  }
}
