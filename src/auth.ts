import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub,
    Google,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const pool = getPool();
        const { rows } = await pool.query(
          "SELECT id, email, name, password_hash FROM users WHERE email = $1",
          [email],
        );
        const user = rows[0];
        if (!user?.password_hash) return null;

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in", error: "/sign-in" },
  callbacks: {
    async signIn({ user, account }) {
      // Credentials provider already verified the user against the DB
      if (account?.provider === "credentials") return true;

      // OAuth providers: check allowlist
      if (!user.email) return false;
      const pool = getPool();
      const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [user.email]);
      return rows.length > 0;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.name = user.name;
        token.email = user.email;
      }
      // Ensure sub is set from DB for OAuth providers
      if (!token.sub && token.email) {
        const pool = getPool();
        const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [token.email]);
        if (rows[0]) token.sub = rows[0].id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.sub as string;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
});
