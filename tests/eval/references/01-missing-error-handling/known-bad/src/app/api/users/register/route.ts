import { NextResponse } from "next/server";

const users: Array<{ email: string; name: string }> = [];

export async function POST(request: Request) {
  const { email, password, name } = await request.json();

  // Happy path only — no validation, no duplicate check, no password hashing
  users.push({ email, name });

  return NextResponse.json({ id: users.length, email, name, password }, { status: 201 });
}
