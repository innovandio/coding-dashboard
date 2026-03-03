import { NextResponse } from "next/server";

const notes: Array<{ id: number; title: string; content: string }> = [];
let seq = 0;

export async function GET() {
  return NextResponse.json(notes);
}

export async function POST(request: Request) {
  const { title, content } = await request.json();
  const note = { id: ++seq, title, content };
  notes.push(note);
  return NextResponse.json(note, { status: 201 });
}
