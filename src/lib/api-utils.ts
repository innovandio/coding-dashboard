import { NextResponse } from "next/server";

/** Standard success response. */
export function apiOk<T>(data?: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

/** Standard error response. */
export function apiError(error: string, status = 500) {
  return NextResponse.json({ ok: false, error }, { status });
}
