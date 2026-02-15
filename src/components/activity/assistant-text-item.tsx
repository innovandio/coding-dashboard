"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const proseClasses =
  "prose prose-invert max-w-none text-xs [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:bg-black/20 [&_pre]:rounded [&_pre]:p-2 [&_pre]:overflow-x-auto [&_pre]:text-[0.7rem] [&_code]:text-[0.7rem] [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_h1]:mt-3 [&_h2]:mt-2 [&_h3]:mt-2 [&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1";

export function AssistantTextRow({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  return (
    <div className="px-2 py-1">
      <div className={proseClasses}>
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
      {isStreaming && (
        <span className="inline-block w-1.5 h-3 ml-0.5 bg-current animate-pulse" />
      )}
    </div>
  );
}

export function ThinkingRow({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="px-2 py-0.5">
      <button
        type="button"
        className="text-[0.65rem] text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide" : "Show"} thinking{isStreaming ? "..." : ""}
      </button>
      {open && (
        <div className="mt-1 pl-2 border-l-2 border-muted-foreground/30 text-muted-foreground whitespace-pre-wrap text-[0.65rem] max-h-48 overflow-y-auto">
          {text}
        </div>
      )}
    </div>
  );
}
