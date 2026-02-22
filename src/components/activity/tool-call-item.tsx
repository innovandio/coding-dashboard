"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { JsonViewer } from "@/components/shared/json-viewer";
import type { ToolCallItem as ToolCallItemData } from "./use-agent-activity";

export function ToolCallRow({ item }: { item: ToolCallItemData }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1.5 w-full text-left px-2 py-1 hover:bg-muted/40 rounded text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        {item.status === "running" ? (
          <Loader2 className="h-3 w-3 text-blue-400 animate-spin shrink-0" />
        ) : (
          <Check className="h-3 w-3 text-green-400 shrink-0" />
        )}
        <Badge variant="outline" className="text-[10px] h-4 font-mono shrink-0">
          {item.name}
        </Badge>
        <span className="text-[10px] text-muted-foreground truncate">{item.argsSummary}</span>
      </button>
      {expanded && item.result != null && (
        <div className="ml-6 mr-2 mb-1 p-2 bg-muted/50 rounded text-xs">
          <JsonViewer data={item.result} />
        </div>
      )}
    </div>
  );
}
