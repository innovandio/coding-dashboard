import { NextResponse } from "next/server";

export interface Note {
  id: number;
  title: string;
  content: string;
  createdAt: string;
}

declare global {
  var __notes: Note[] | undefined;
  var __noteSeq: number | undefined;
}

function getNotes(): Note[] {
  if (!globalThis.__notes) globalThis.__notes = [];
  return globalThis.__notes;
}

function nextId(): number {
  if (!globalThis.__noteSeq) globalThis.__noteSeq = 0;
  return ++globalThis.__noteSeq;
}

export async function GET() {
  return NextResponse.json(getNotes());
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, content } = body as { title?: string; content?: string };

  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const note: Note = {
    id: nextId(),
    title,
    content: content ?? "",
    createdAt: new Date().toISOString(),
  };

  getNotes().push(note);
  return NextResponse.json(note, { status: 201 });
}
