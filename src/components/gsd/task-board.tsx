"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronRight,
  ChevronDown,
  Circle,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GsdTask } from "@/hooks/use-dashboard-state";

interface PhaseGroup {
  phaseNumber: number;
  title: string;
  status: string;
  plans: GsdTask[];
}

function groupByPhase(tasks: GsdTask[]): PhaseGroup[] {
  const phaseMap = new Map<number, PhaseGroup>();
  const ungrouped: GsdTask[] = [];

  // First pass: collect phase headers
  for (const task of tasks) {
    if (task.meta?.taskType === "phase" && task.meta.phaseNumber != null) {
      phaseMap.set(task.meta.phaseNumber, {
        phaseNumber: task.meta.phaseNumber,
        title: task.title,
        status: task.status,
        plans: [],
      });
    }
  }

  // Second pass: assign plans to phases
  for (const task of tasks) {
    if (task.meta?.taskType === "plan" && task.meta.phaseNumber != null) {
      const phase = phaseMap.get(task.meta.phaseNumber);
      if (phase) {
        phase.plans.push(task);
      } else {
        // Create implicit phase group
        phaseMap.set(task.meta.phaseNumber, {
          phaseNumber: task.meta.phaseNumber,
          title: `Phase ${task.meta.phaseNumber}`,
          status: "todo",
          plans: [task],
        });
      }
    } else if (task.meta?.taskType !== "phase") {
      ungrouped.push(task);
    }
  }

  // Derive phase status from child plans if not explicitly set by a phase header
  for (const phase of phaseMap.values()) {
    if (phase.plans.length > 0) {
      const allDone = phase.plans.every((p) => p.status === "done");
      const anyDoing = phase.plans.some((p) => p.status === "doing");
      const anyBlocked = phase.plans.some((p) => p.status === "blocked");
      if (allDone) phase.status = "done";
      else if (anyBlocked) phase.status = "blocked";
      else if (anyDoing) phase.status = "doing";
    }
  }

  const phases = Array.from(phaseMap.values()).sort(
    (a, b) => a.phaseNumber - b.phaseNumber
  );

  // Add ungrouped tasks as a misc phase if any
  if (ungrouped.length > 0) {
    phases.push({
      phaseNumber: 999,
      title: "Other Tasks",
      status: "todo",
      plans: ungrouped,
    });
  }

  return phases;
}

const statusIcon: Record<string, React.ReactNode> = {
  todo: <Circle className="h-3.5 w-3.5 text-muted-foreground" />,
  doing: <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />,
  blocked: <AlertCircle className="h-3.5 w-3.5 text-red-500" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
};

const phaseStatusColor: Record<string, string> = {
  done: "bg-green-500",
  doing: "bg-blue-500",
  blocked: "bg-red-500",
  todo: "bg-muted-foreground/30",
};

function ProgressBar({ plans }: { plans: GsdTask[] }) {
  if (plans.length === 0) return null;
  const done = plans.filter((p) => p.status === "done").length;
  const pct = Math.round((done / plans.length) * 100);

  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct === 100 ? "bg-green-500" : "bg-blue-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
        {done}/{plans.length}
      </span>
    </div>
  );
}

function PhaseSection({ phase }: { phase: PhaseGroup }) {
  const [expanded, setExpanded] = useState(phase.status !== "done");
  const done = phase.plans.filter((p) => p.status === "done").length;
  const allDone = phase.plans.length > 0 && done === phase.plans.length;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors",
          allDone && "opacity-60"
        )}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <div
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            phaseStatusColor[phase.status] ?? phaseStatusColor.todo
          )}
        />
        <span className={cn("text-xs font-medium flex-1 truncate", allDone && "line-through")}>
          {phase.title}
        </span>
        <ProgressBar plans={phase.plans} />
      </button>
      {expanded && phase.plans.length > 0 && (
        <div className="border-t border-border divide-y divide-border">
          {phase.plans.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 pl-8",
                plan.status === "done" && "opacity-50"
              )}
            >
              {statusIcon[plan.status] ?? statusIcon.todo}
              <span
                className={cn(
                  "text-xs flex-1 truncate",
                  plan.status === "done" && "line-through"
                )}
              >
                {plan.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskBoard({ tasks }: { tasks: GsdTask[] }) {
  const phases = groupByPhase(tasks);
  const totalTasks = tasks.filter((t) => t.meta?.taskType !== "phase").length;
  const doneTasks = tasks.filter(
    (t) => t.meta?.taskType !== "phase" && t.status === "done"
  ).length;
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <Card className="h-full rounded-none border-0 border-b border-border flex flex-col gap-0 py-0">
      <CardHeader className="py-1 px-3 gap-0 flex-none">
        <CardTitle className="text-xs font-medium flex items-center gap-3">
          GSD Tasks
          {totalTasks > 0 && (
            <>
              <Badge variant="secondary" className="text-[10px] h-4">
                {doneTasks}/{totalTasks} done
              </Badge>
              <div className="flex items-center gap-2 flex-1 max-w-xs">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      pct === 100 ? "bg-green-500" : "bg-blue-500"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">{pct}%</span>
              </div>
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 px-2 pb-2 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          {phases.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1 py-4 text-center">
              No GSD tasks found. Configure a workspace path and refresh.
            </p>
          ) : (
            <div className="space-y-1.5">
              {phases.map((phase) => (
                <PhaseSection key={phase.phaseNumber} phase={phase} />
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
