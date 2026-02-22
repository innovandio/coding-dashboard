"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";

export function LifecycleBanner({
  state,
  runStartedAt,
}: {
  state: "idle" | "running" | "error";
  runStartedAt: number | null;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state !== "running" || !runStartedAt) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.round((Date.now() - runStartedAt) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.round((Date.now() - runStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [state, runStartedAt]);

  if (state === "idle") {
    return <div className="px-3 py-1 mb-3 text-[10px] text-muted-foreground bg-muted/30">Idle</div>;
  }

  if (state === "error") {
    return (
      <div className="px-3 py-1 mb-3 text-[10px] text-red-400 bg-red-500/10 flex items-center gap-1">
        <AlertCircle className="h-3 w-3" />
        Error
      </div>
    );
  }

  return (
    <div className="px-3 py-1 mb-3 text-[10px] text-blue-400 bg-blue-500/10 flex items-center gap-1">
      <Loader2 className="h-3 w-3 animate-spin" />
      Running -- {elapsed}s
    </div>
  );
}
