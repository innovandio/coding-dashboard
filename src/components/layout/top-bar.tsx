"use client";

import { useSession, signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { ProjectManagerDialog } from "@/components/shared/project-manager-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Project } from "@/hooks/use-dashboard-state";

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    return name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return (email?.[0] ?? "?").toUpperCase();
}

export function TopBar({
  projects,
  selectedProjectId,
  onSelectProject,
  onProjectAdded,
  loading,
}: {
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onProjectAdded: () => void;
  loading?: boolean;
}) {
  const { data: session } = useSession();

  return (
    <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-semibold tracking-tight">Coding Dashboard</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center">
          {loading ? (
            <Skeleton className="h-9 w-48 rounded-r-none" />
          ) : projects.length > 0 ? (
            <Select value={selectedProjectId ?? projects[0].id} onValueChange={onSelectProject}>
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

        {session?.user && (
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="size-7 cursor-pointer">
                <AvatarImage src={session.user.image ?? undefined} alt={session.user.name ?? ""} />
                <AvatarFallback className="text-[10px]">
                  {getInitials(session.user.name, session.user.email)}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-1">
                  {session.user.name && (
                    <p className="text-sm font-medium leading-none">{session.user.name}</p>
                  )}
                  {session.user.email && (
                    <p className="text-xs text-muted-foreground">{session.user.email}</p>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()} title="Sign out">
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
