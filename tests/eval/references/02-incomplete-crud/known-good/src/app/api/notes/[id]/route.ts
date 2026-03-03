import { NextResponse } from "next/server";
import type { Note } from "../route";

function getNotes(): Note[] {
  if (!globalThis.__notes) globalThis.__notes = [];
  return globalThis.__notes;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const note = getNotes().find((n) => n.id === Number(id));
  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(note);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notes = getNotes();
  const index = notes.findIndex((n) => n.id === Number(id));
  if (index === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  notes[index] = { ...notes[index], ...body };
  return NextResponse.json(notes[index]);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notes = getNotes();
  const index = notes.findIndex((n) => n.id === Number(id));
  if (index === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  notes.splice(index, 1);
  return NextResponse.json({ deleted: true });
}
