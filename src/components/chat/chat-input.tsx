"use client";

import { useRef, useCallback, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";

export function ChatInput({
  onSend,
  onAbort,
  isStreaming,
  disabled,
}: {
  onSend: (message: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const value = textarea.value.trim();
    if (!value) return;
    onSend(value);
    textarea.value = "";
    textarea.style.height = "auto";
  }, [onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
  }, []);

  return (
    <div className="flex gap-2 items-end px-3 py-1.5 border-t">
      <textarea
        ref={textareaRef}
        className="flex-1 resize-none bg-muted/50 border rounded-md px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[32px] max-h-[120px]"
        placeholder="Send a message..."
        aria-label="Chat message"
        rows={1}
        disabled={disabled}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
      />
      {isStreaming ? (
        <Button size="xs" variant="destructive" onClick={onAbort}>
          Stop
        </Button>
      ) : (
        <Button size="xs" onClick={handleSend} disabled={disabled}>
          Send
        </Button>
      )}
    </div>
  );
}
