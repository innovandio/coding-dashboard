import { auth } from "@/auth";

export async function requireAuth() {
  const session = await auth();
  if (!session) return null;
  return session;
}
