"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { StepProgressDialog } from "@/components/shared/step-progress-dialog";
import {
  ModelConfigForm,
  emptyModelConfig,
  type ModelConfigState,
} from "@/components/shared/model-config-form";
import {
  HeartbeatConfigForm,
  defaultHeartbeatConfig,
} from "@/components/shared/heartbeat-config-form";
import { ProjectEditDialog } from "@/components/shared/project-edit-dialog";
import { useStepProgress } from "@/hooks/use-step-progress";
import { Settings, Pencil, Trash2, Plus, Check, X } from "lucide-react";
import type { Project } from "@/hooks/use-dashboard-state";
import type { HeartbeatConfig } from "@/lib/heartbeat-config";

interface OpenClawAgent {
  id: string;
  identityName: string;
  identityEmoji: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function ProjectManagerDialog({
  projects,
  onChanged,
}: {
  projects: Project[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Edit dialog state
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add state
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [basedOn, setBasedOn] = useState("__blank__");
  const [modelConfig, setModelConfig] = useState<ModelConfigState>(emptyModelConfig);
  const [useGlobalModel, setUseGlobalModel] = useState(true);
  const [heartbeatConfig, setHeartbeatConfig] = useState<HeartbeatConfig>(defaultHeartbeatConfig);
  const [addPhase, setAddPhase] = useState<"idle" | "confirm">("idle");
  const [addError, setAddError] = useState<string | null>(null);

  // Step-progress modal state
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressTitle, setProgressTitle] = useState("");
  const progress = useStepProgress();

  // Cleanup abort controller on unmount
  useEffect(() => progress.cleanup, [progress.cleanup]);

  // Agents for "based on" picker
  const [agents, setAgents] = useState<OpenClawAgent[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAgents(data);
      })
      .catch(() => {});
  }, [open]);

  function confirmDelete(id: string) {
    setDeletingId(null);
    setOpen(false);
    setProgressTitle("Deleting Project");
    setProgressOpen(true);
    progress.start(`/api/projects/${id}/delete`, { method: "POST" });
  }

  const newAgentId = slugify(newName);
  const addBusy = progressOpen;

  function handleAddOrConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!newName || !newAgentId || !newPath) return;

    if (addPhase === "idle") {
      setAddPhase("confirm");
      setAddError(null);
      return;
    }
    if (addPhase === "confirm") {
      doAdd();
    }
  }

  function doAdd() {
    setOpen(false);
    setProgressTitle("Creating Project");
    setProgressOpen(true);
    progress.start("/api/projects/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: newAgentId,
        name: newName,
        workspace: newPath,
        basedOn: basedOn === "__blank__" ? null : basedOn,
        modelConfig: !useGlobalModel && modelConfig.apiKey ? modelConfig : undefined,
        heartbeatConfig: heartbeatConfig.enabled ? heartbeatConfig : undefined,
      }),
    });
  }

  function handleProgressClose() {
    const wasSuccess = progress.success;
    setProgressOpen(false);
    progress.reset();

    if (wasSuccess) {
      // Reset add form
      setAdding(false);
      setNewName("");
      setNewPath("");
      setBasedOn("__blank__");
      setModelConfig(emptyModelConfig);
      setUseGlobalModel(true);
      setHeartbeatConfig(defaultHeartbeatConfig());
      setAddPhase("idle");
      setAddError(null);
      onChanged();
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!addBusy) setOpen(v);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" size="icon" className="rounded-l-none">
            <Settings className="size-3.5" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Projects</DialogTitle>
          </DialogHeader>

          <div className="space-y-1 max-h-64 overflow-y-auto">
            {projects.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No projects yet.</p>
            )}
            {projects.map((p) => (
              <div key={p.id}>
                {deletingId === p.id ? (
                  <div className="flex items-center justify-between rounded-md border border-destructive/50 px-3 py-2">
                    <span className="text-xs text-destructive">Delete {p.name}?</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-xs" onClick={() => setDeletingId(null)}>
                        <X className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => confirmDelete(p.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Check className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted/50">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{p.name}</p>
                      {p.workspace_path && (
                        <p className="text-[10px] text-muted-foreground truncate">
                          {p.workspace_path}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          setEditingProject(p);
                          setDeletingId(null);
                          setAdding(false);
                        }}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          setDeletingId(p.id);
                          setAdding(false);
                        }}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {adding ? (
            <form onSubmit={handleAddOrConfirm} className="space-y-3 border-t pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="pm-name" className="text-xs">
                  Name
                </Label>
                <Input
                  id="pm-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="My Project"
                  className="h-7 text-xs"
                  disabled={addBusy}
                  required
                />
                {newAgentId && (
                  <p className="text-[10px] text-muted-foreground">
                    Agent ID: <span className="font-mono">{newAgentId}</span>
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-workspace" className="text-xs">
                  Workspace Path
                </Label>
                <FolderPicker
                  id="pm-workspace"
                  value={newPath}
                  onChange={setNewPath}
                  placeholder="/Users/me/projects/my-project"
                  className="h-7 text-xs"
                  disabled={addBusy}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Based on</Label>
                <Select value={basedOn} onValueChange={setBasedOn} disabled={addBusy}>
                  <SelectTrigger className="w-full h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__blank__">Coding Template</SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.identityEmoji} {a.identityName} ({a.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Model</Label>
                <Select
                  value={useGlobalModel ? "global" : "custom"}
                  onValueChange={(v) => {
                    setUseGlobalModel(v === "global");
                    if (v === "global") setModelConfig(emptyModelConfig);
                  }}
                  disabled={addBusy}
                >
                  <SelectTrigger className="w-full h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Use global default</SelectItem>
                    <SelectItem value="custom">Configure per-project</SelectItem>
                  </SelectContent>
                </Select>
                {!useGlobalModel && (
                  <ModelConfigForm
                    value={modelConfig}
                    onChange={setModelConfig}
                    disabled={addBusy}
                    compact
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Heartbeat</Label>
                <HeartbeatConfigForm
                  value={heartbeatConfig}
                  onChange={setHeartbeatConfig}
                  disabled={addBusy}
                />
              </div>
              {addPhase === "confirm" && (
                <div className="rounded-md border border-yellow-600/40 bg-yellow-950/30 px-3 py-2 text-xs text-yellow-200">
                  Adding a project will restart the OpenClaw gateway to mount the workspace. Any
                  active agent sessions will be interrupted briefly.
                </div>
              )}
              {addError && <p className="text-xs text-destructive">{addError}</p>}
              {addPhase === "confirm" ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAddPhase("idle");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm">
                    Confirm & Restart Gateway
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={addBusy}
                    onClick={() => {
                      setAdding(false);
                      setAddError(null);
                      setAddPhase("idle");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={addBusy || !newAgentId || !newPath}>
                    Add Project
                  </Button>
                </div>
              )}
            </form>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setAdding(true);
                setDeletingId(null);
              }}
            >
              <Plus className="size-3.5 mr-1" />
              Add Project
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <ProjectEditDialog
        project={editingProject}
        onClose={() => setEditingProject(null)}
        onSaved={onChanged}
      />

      <StepProgressDialog
        open={progressOpen}
        title={progressTitle}
        steps={progress.steps}
        done={progress.done}
        success={progress.success}
        globalError={progress.globalError}
        onClose={handleProgressClose}
      />
    </>
  );
}
