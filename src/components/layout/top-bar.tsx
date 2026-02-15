"use client";

import { ConnectionDot } from "@/components/shared/connection-dot";
import { AddProjectDialog } from "@/components/shared/add-project-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Project, HealthState } from "@/hooks/use-dashboard-state";
import type { ConnectionState } from "@/lib/gateway-protocol";

export function TopBar({
  health,
  projects,
  selectedProjectId,
  onSelectProject,
  onProjectAdded,
}: {
  health: HealthState;
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onProjectAdded: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-semibold tracking-tight">Coding Dashboard</h1>
        <ConnectionDot status={health.connectionState as ConnectionState} />
        {health.tickAgeMs !== null && (
          <span className="text-xs text-muted-foreground">
            tick {Math.round(health.tickAgeMs / 1000)}s ago
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {projects.length > 0 ? (
          <Select
            value={selectedProjectId ?? projects[0].id}
            onValueChange={onSelectProject}
          >
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">No projects</span>
        )}

        <AddProjectDialog onAdded={onProjectAdded} />
      </div>
    </div>
  );
}
