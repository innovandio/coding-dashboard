"use client";

import { ConnectionDot } from "@/components/shared/connection-dot";
import { ProjectManagerDialog } from "@/components/shared/project-manager-dialog";
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
        <div className="flex items-center">
          {projects.length > 0 ? (
            <Select
              value={selectedProjectId ?? projects[0].id}
              onValueChange={onSelectProject}
            >
              <SelectTrigger className="w-48 text-xs rounded-r-none border-r-0">
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
            <div className="flex h-9 w-48 items-center rounded-md rounded-r-none border border-r-0 border-input bg-transparent px-3 py-2 text-xs text-muted-foreground shadow-xs">
              No projects
            </div>
          )}
          <ProjectManagerDialog projects={projects} onChanged={onProjectAdded} />
        </div>
      </div>
    </div>
  );
}
