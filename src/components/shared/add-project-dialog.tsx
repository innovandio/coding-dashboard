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

export function AddProjectDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [basedOn, setBasedOn] = useState("__blank__");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<OpenClawAgent[]>([]);

  // Fetch available OpenClaw agents when dialog opens
  useEffect(() => {
    if (!open) return;
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAgents(data);
      })
      .catch(() => {});
  }, [open]);

  const agentId = slugify(name);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !agentId || !workspacePath) return;

    setSaving(true);
    setError(null);
    try {
      // 1. Create OpenClaw agent
      const agentRes = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          workspace: workspacePath,
          basedOn: basedOn === "__blank__" ? null : basedOn,
        }),
      });
      if (!agentRes.ok) {
        const data = await agentRes.json();
        throw new Error(data.error ?? "Failed to create agent");
      }

      // 2. Create project in dashboard DB
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: agentId,
          agent_id: agentId,
          name,
          workspace_path: workspacePath,
        }),
      });

      setOpen(false);
      setName("");
      setWorkspacePath("");
      setBasedOn("__blank__");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          + Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              required
            />
            {agentId && (
              <p className="text-xs text-muted-foreground">
                Agent ID: <span className="font-mono">{agentId}</span>
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace">Workspace Path</Label>
            <Input
              id="workspace"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              placeholder="/Users/me/projects/my-project"
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Based on</Label>
            <Select value={basedOn} onValueChange={setBasedOn}>
              <SelectTrigger>
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
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
          <Button
            type="submit"
            disabled={saving || !agentId || !workspacePath}
            className="w-full"
          >
            {saving ? "Creating agent..." : "Add Project"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
