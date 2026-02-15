import { NextResponse } from "next/server";
import { getIngestorState } from "@/lib/gateway-ingestor";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getIngestorState());
}
