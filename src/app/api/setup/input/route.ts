import { NextRequest, NextResponse } from "next/server";
import { writeSetupInput } from "@/lib/setup-process";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { data } = await req.json();

  if (typeof data !== "string") {
    return NextResponse.json({ error: "data (string) required" }, { status: 400 });
  }

  writeSetupInput(data);
  return NextResponse.json({ ok: true });
}
