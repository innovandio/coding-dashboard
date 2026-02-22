"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { HeartbeatConfig } from "@/lib/heartbeat-config";

interface Props {
  value: HeartbeatConfig;
  onChange: (v: HeartbeatConfig) => void;
  disabled?: boolean;
}

export type { HeartbeatConfig };

export function defaultHeartbeatConfig(): HeartbeatConfig {
  return {
    enabled: false,
    every: "30m",
    activeHoursStart: "",
    activeHoursEnd: "",
    prompt: "",
  };
}

export function HeartbeatConfigForm({ value, onChange, disabled }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(
    !!(value.activeHoursStart || value.activeHoursEnd || value.prompt)
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Switch
          checked={value.enabled}
          onCheckedChange={(checked) =>
            onChange({ ...value, enabled: !!checked })
          }
          disabled={disabled}
        />
        <Label className="text-xs">Enable Heartbeat</Label>
      </div>

      {value.enabled && (
        <div className="space-y-2 pl-1">
          <div className="space-y-1">
            <Label className="text-[11px]">Interval</Label>
            <Input
              value={value.every}
              onChange={(e) => onChange({ ...value, every: e.target.value })}
              placeholder="30m"
              className="h-7 text-xs"
              disabled={disabled}
            />
            <p className="text-[10px] text-muted-foreground">
              e.g. 30m, 1h, 2h
            </p>
          </div>

          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            Advanced
          </button>

          {showAdvanced && (
            <div className="space-y-2 pl-1">
              <div className="space-y-1">
                <Label className="text-[11px]">Active Hours</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={value.activeHoursStart}
                    onChange={(e) =>
                      onChange({ ...value, activeHoursStart: e.target.value })
                    }
                    placeholder="09:00"
                    className="h-7 text-xs w-24"
                    disabled={disabled}
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    value={value.activeHoursEnd}
                    onChange={(e) =>
                      onChange({ ...value, activeHoursEnd: e.target.value })
                    }
                    placeholder="17:00"
                    className="h-7 text-xs w-24"
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">Custom Prompt</Label>
                <textarea
                  value={value.prompt}
                  onChange={(e) =>
                    onChange({ ...value, prompt: e.target.value })
                  }
                  placeholder="Default: reads HEARTBEAT.md and acts on it"
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[60px] resize-y"
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
