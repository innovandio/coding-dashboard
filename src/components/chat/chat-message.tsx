"use client";

export { proseClasses } from "@/lib/styles";

export interface ChatMessageData {
  id: string;
  role: "user";
  content: string;
}

export function ChatMessage({ message }: { message: ChatMessageData }) {
  return (
    <div className="flex w-full px-3 py-1.5 justify-end">
      <div className="max-w-[85%] rounded-lg px-3 py-2 text-xs break-words bg-primary text-primary-foreground">
        <span className="whitespace-pre-wrap">{message.content || "\u200b"}</span>
      </div>
    </div>
  );
}
