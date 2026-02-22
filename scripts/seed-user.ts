#!/usr/bin/env npx tsx
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const args = process.argv.slice(2);
let email = "";
let name = "";
let password = "";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--email" && args[i + 1]) email = args[++i];
  if (args[i] === "--name" && args[i + 1]) name = args[++i];
  if (args[i] === "--password" && args[i + 1]) password = args[++i];
}

if (!email) {
  console.error(
    "Usage: npx tsx scripts/seed-user.ts --email you@example.com [--name 'Your Name'] [--password 'secret']",
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = COALESCE($2, users.name), password_hash = COALESCE($3, users.password_hash)
     RETURNING id, email, name`,
    [email, name || null, passwordHash],
  );
  console.log("User upserted:", rows[0]);
} catch (err) {
  console.error("Failed to seed user:", err);
  process.exit(1);
} finally {
  await pool.end();
}
