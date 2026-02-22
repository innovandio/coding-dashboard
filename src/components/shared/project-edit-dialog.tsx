"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderPicker } from "@/components/shared/folder-picker";
import {
  ModelConfigForm,
  emptyModelConfig,
  type ModelConfigState,
} from "@/components/shared/model-config-form";
import {
  HeartbeatConfigForm,
  defaultHeartbeatConfig,
} from "@/components/shared/heartbeat-config-form";
import type { HeartbeatConfig } from "@/lib/heartbeat-config";
import type { Project } from "@/hooks/use-dashboard-state";

interface Props {
  project: Project | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ProjectEditDialog({ project, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [modelMode, setModelMode] = useState<"keep" | "custom">("keep");
  const [modelConfig, setModelConfig] = useState<ModelConfigState>(emptyModelConfig);
  const [heartbeat, setHeartbeat] = useState<HeartbeatConfig>(defaultHeartbeatConfig);
  const [saving, setSaving] = useState(false);
  const [loadingHeartbeat, setLoadingHeartbeat] = useState(false);

  // Populate form when project changes
  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setWorkspacePath(project.workspace_path ?? "");
    setModelMode("keep");
    setModelConfig(emptyModelConfig);
    setSaving(false);

    // Fetch heartbeat config
    setLoadingHeartbeat(true);
    fetch(`/api/projects/${project.id}/heartbeat`)
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data.enabled === "boolean") {
          setHeartbeat(data);
        } else {
          setHeartbeat(defaultHeartbeatConfig());
        }
      })
      .catch(() => setHeartbeat(defaultHeartbeatConfig()))
      .finally(() => setLoadingHeartbeat(false));
  }, [project]);

  async function handleSave() {
    if (!project || !name) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name,
        workspace_path: workspacePath,
        heartbeat,
      };
      if (modelMode === "custom" && modelConfig.apiKey) {
        body.meta = { modelConfig };
      }
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={!!project}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Project{project ? `: ${project.name}` : ""}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name" className="text-xs">
              Name
            </Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="h-7 text-xs"
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-workspace" className="text-xs">
              Workspace Path
            </Label>
            <FolderPicker
              id="edit-workspace"
              value={workspacePath}
              onChange={setWorkspacePath}
              placeholder="/Users/me/projects/my-project"
              className="h-7 text-xs"
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Model</Label>
            <Select
              value={modelMode}
              onValueChange={(v) => {
                setModelMode(v as "keep" | "custom");
                if (v === "keep") setModelConfig(emptyModelConfig);
              }}
              disabled={saving}
            >
              <SelectTrigger className="w-full h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Keep current</SelectItem>
                <SelectItem value="custom">Change model</SelectItem>
              </SelectContent>
            </Select>
            {modelMode === "custom" && (
              <ModelConfigForm
                value={modelConfig}
                onChange={setModelConfig}
                disabled={saving}
                compact
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Heartbeat</Label>
            {loadingHeartbeat ? (
              <p className="text-[10px] text-muted-foreground">Loading...</p>
            ) : (
              <HeartbeatConfigForm value={heartbeat} onChange={setHeartbeat} disabled={saving} />
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving || !name} onClick={handleSave}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
