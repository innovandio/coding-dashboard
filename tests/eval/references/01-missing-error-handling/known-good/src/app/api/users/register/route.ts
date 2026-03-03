import { NextResponse } from "next/server";

const users = new Map<string, { email: string; name: string; passwordHash: string }>();

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, password, name } = body as {
    email?: string;
    password?: string;
    name?: string;
  };

  const errors: string[] = [];
  if (!email) errors.push("email is required");
  if (!password) errors.push("password is required");
  if (email && !isValidEmail(email)) errors.push("invalid email format");
  if (password && password.length < 8) errors.push("password must be at least 8 characters");

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  if (users.has(email!)) {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 });
  }

  const passwordHash = `hashed:${password!}`;
  users.set(email!, { email: email!, name: name ?? "", passwordHash });

  return NextResponse.json({ id: users.size, email: email!, name: name ?? "" }, { status: 201 });
}
