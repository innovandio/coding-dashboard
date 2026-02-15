import { NextRequest, NextResponse } from "next/server";
import { resizeTmuxWindow } from "@/lib/tmux-scanner";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { session, cols, rows } = await req.json();

  if (!session || !cols || !rows) {
    return NextResponse.json({ error: "session, cols, and rows required" }, { status: 400 });
  }

  try {
    await resizeTmuxWindow(session, Math.floor(cols), Math.floor(rows));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[tmux/resize] Failed to resize:", err);
    return NextResponse.json({ error: "Failed to resize" }, { status: 500 });
  }
}
