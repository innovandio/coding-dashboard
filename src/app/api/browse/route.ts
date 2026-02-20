import { NextRequest, NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { homedir } from "os";
import { join, resolve, dirname } from "path";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rawPath = req.nextUrl.searchParams.get("path") || homedir();
  const dirPath = resolve(rawPath.startsWith("~") ? homedir() + rawPath.slice(1) : rawPath);

  try {
    const info = await stat(dirPath);
    if (!info.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    const entries = await readdir(dirPath, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({ name: e.name, path: join(dirPath, e.name) }));

    return NextResponse.json({
      current: dirPath,
      parent: dirname(dirPath) !== dirPath ? dirname(dirPath) : null,
      directories: dirs,
    });
  } catch {
    return NextResponse.json({ error: "Cannot read directory" }, { status: 400 });
  }
}
