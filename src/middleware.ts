import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const secret = process.env.AUTH_SECRET;

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret });

  if (!token) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /api/auth (Auth.js handlers)
     * - /sign-in (login page)
     * - /callback (Claude OAuth)
     * - /_next (Next.js internals)
     * - /favicon.ico, /icon.*, /apple-icon.* (static assets)
     */
    "/((?!api/auth|sign-in|callback|auth/callback|_next|favicon\\.ico|icon|apple-icon).*)",
  ],
};
