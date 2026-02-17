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

function SphereToggle({
  active,
  onChange,
}: {
  active: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!active)}
      className="relative inline-flex items-center h-5 w-9 rounded-full transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        background: active
          ? "rgba(40, 100, 200, 0.35)"
          : "rgba(255, 255, 255, 0.08)",
        border: `1px solid ${active ? "rgba(60, 140, 255, 0.4)" : "rgba(255, 255, 255, 0.1)"}`,
      }}
      aria-label="Toggle AI sphere"
      role="switch"
      aria-checked={active}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full transition-all duration-300"
        style={{
          transform: active ? "translateX(17px)" : "translateX(3px)",
          background: active ? "rgba(80, 160, 255, 0.85)" : "rgba(255, 255, 255, 0.22)",
          boxShadow: active ? "0 0 8px rgba(80, 160, 255, 0.5)" : "none",
        }}
      />
    </button>
  );
}

export function TopBar({
  health,
  projects,
  selectedProjectId,
  onSelectProject,
  onProjectAdded,
  sphereActive,
  onSphereToggle,
}: {
  health: HealthState;
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onProjectAdded: () => void;
  sphereActive: boolean;
  onSphereToggle: (v: boolean) => void;
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
        <SphereToggle active={sphereActive} onChange={onSphereToggle} />

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
