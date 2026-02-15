"use client";

import { cn } from "@/lib/utils";
import type { GsdTask } from "@/hooks/use-dashboard-state";

const statusAccent: Record<string, string> = {
  todo: "border-l-muted-foreground",
  doing: "border-l-blue-500",
  blocked: "border-l-red-500",
  done: "border-l-green-500",
};

export function TaskCard({ task }: { task: GsdTask }) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card p-2 border-l-2",
        statusAccent[task.status] ?? "border-l-muted-foreground"
      )}
    >
      <p className="text-xs font-medium leading-tight">{task.title}</p>
      <div className="flex items-center gap-2 mt-1">
        {task.wave !== null && (
          <span className="text-[10px] text-muted-foreground">W{task.wave}</span>
        )}
        {task.file_path && (
          <span className="text-[10px] text-muted-foreground truncate max-w-32">
            {task.file_path.split("/").pop()}
          </span>
        )}
      </div>
    </div>
  );
}
