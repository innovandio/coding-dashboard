"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Session } from "@/hooks/use-dashboard-state";

export function SessionTabs({
  sessions,
  selectedSessionId,
  onSelectSession,
}: {
  sessions: Session[];
  selectedSessionId: string | null;
  onSelectSession: (id: string | null) => void;
}) {
  if (sessions.length === 0) return null;

  return (
    <div className="border-b border-border bg-card px-4 py-1">
      <Tabs
        value={selectedSessionId ?? "__all__"}
        onValueChange={(v) => onSelectSession(v === "__all__" ? null : v)}
      >
        <TabsList className="h-7 bg-transparent">
          <TabsTrigger value="__all__" className="text-xs h-6 px-2">
            All
          </TabsTrigger>
          {sessions.map((s) => (
            <TabsTrigger key={s.id} value={s.id} className="text-xs h-6 px-2">
              {s.name ?? s.id.slice(0, 8)}
              {s.status === "active" && (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
