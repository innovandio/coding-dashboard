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
import { Settings, Pencil, Trash2, Plus, Check, X } from "lucide-react";
import type { Project } from "@/hooks/use-dashboard-state";

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

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPath, setEditPath] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Add state
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [basedOn, setBasedOn] = useState("__blank__");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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

  function startEdit(project: Project) {
    setEditingId(project.id);
    setEditName(project.name);
    setEditPath(project.workspace_path ?? "");
    setDeletingId(null);
    setAdding(false);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    setEditSaving(true);
    try {
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, workspace_path: editPath }),
      });
      setEditingId(null);
      onChanged();
    } finally {
      setEditSaving(false);
    }
  }

  async function confirmDelete(id: string) {
    setDeleteLoading(true);
    try {
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
      setDeletingId(null);
      onChanged();
    } finally {
      setDeleteLoading(false);
    }
  }

  const newAgentId = slugify(newName);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName || !newAgentId || !newPath) return;

    setAddSaving(true);
    setAddError(null);
    try {
      const agentRes = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: newAgentId,
          workspace: newPath,
          basedOn: basedOn === "__blank__" ? null : basedOn,
        }),
      });
      if (!agentRes.ok) {
        const data = await agentRes.json();
        throw new Error(data.error ?? "Failed to create agent");
      }

      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: newAgentId,
          agent_id: newAgentId,
          name: newName,
          workspace_path: newPath,
        }),
      });

      setAdding(false);
      setNewName("");
      setNewPath("");
      setBasedOn("__blank__");
      onChanged();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAddSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            <p className="text-xs text-muted-foreground py-2">
              No projects yet.
            </p>
          )}
          {projects.map((p) => (
            <div key={p.id}>
              {editingId === p.id ? (
                <div className="space-y-2 rounded-md border p-3">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Name"
                    className="h-7 text-xs"
                  />
                  <Input
                    value={editPath}
                    onChange={(e) => setEditPath(e.target.value)}
                    placeholder="Workspace path"
                    className="h-7 text-xs"
                  />
                  <div className="flex gap-1 justify-end">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={cancelEdit}
                    >
                      <X className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={editSaving || !editName}
                      onClick={() => saveEdit(p.id)}
                    >
                      <Check className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ) : deletingId === p.id ? (
                <div className="flex items-center justify-between rounded-md border border-destructive/50 px-3 py-2">
                  <span className="text-xs text-destructive">
                    Delete {p.name}?
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setDeletingId(null)}
                    >
                      <X className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={deleteLoading}
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
                      onClick={() => startEdit(p)}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => {
                        setDeletingId(p.id);
                        setEditingId(null);
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
          <form onSubmit={handleAdd} className="space-y-3 border-t pt-3">
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
              <Input
                id="pm-workspace"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="/Users/me/projects/my-project"
                className="h-7 text-xs"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Based on</Label>
              <Select value={basedOn} onValueChange={setBasedOn}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__blank__">Blank agent</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.identityEmoji} {a.identityName} ({a.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {addError && (
              <p className="text-xs text-destructive">{addError}</p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setAddError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={addSaving || !newAgentId || !newPath}
              >
                {addSaving ? "Creating..." : "Add Project"}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
              setDeletingId(null);
            }}
          >
            <Plus className="size-3.5 mr-1" />
            Add Project
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
