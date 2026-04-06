import { NextResponse } from "next/server";

// Incomplete: GET by ID exists but PUT and DELETE are not implemented
export async function GET() {
  return NextResponse.json({ error: "Not implemented" }, { status: 500 });
}
