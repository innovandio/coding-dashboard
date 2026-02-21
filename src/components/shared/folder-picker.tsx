"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FolderOpen, FolderIcon, ChevronUp, Loader2 } from "lucide-react";

interface BrowseResult {
  current: string;
  parent: string | null;
  directories: { name: string; path: string }[];
}

export function FolderPicker({
  value,
  onChange,
  disabled,
  placeholder,
  className,
  id,
}: {
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (path?: string) => {
    setLoading(true);
    try {
      const url = path
        ? `/api/browse?path=${encodeURIComponent(path)}`
        : "/api/browse";
      const res = await fetch(url);
      if (res.ok) {
        const data: BrowseResult = await res.json();
        setBrowseResult(data);
        setBrowsePath(data.current);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      browse(value || undefined);
    }
  }, [open, browse, value]);

  function selectFolder(path: string) {
    onChange(path);
    setOpen(false);
  }

  return (
    <div className="flex items-stretch">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "/path/to/project"}
        className={`${className ?? ""} rounded-r-none border-r-0`}
        disabled={disabled}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            disabled={disabled}
            className="shrink-0 h-auto rounded-l-none"
          >
            <FolderOpen className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 p-0"
        >
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!browseResult?.parent || loading}
              onClick={() => browseResult?.parent && browse(browseResult.parent)}
            >
              <ChevronUp className="size-3" />
            </Button>
            <span className="text-[10px] text-muted-foreground truncate flex-1 font-mono">
              {browsePath ?? "..."}
            </span>
          </div>

          <div className="max-h-52 overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : browseResult?.directories.length === 0 ? (
              <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                No subdirectories
              </p>
            ) : (
              <div className="py-1">
                {browseResult?.directories.map((d) => (
                  <button
                    key={d.path}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1 text-xs hover:bg-muted/50 text-left"
                    onDoubleClick={() => selectFolder(d.path)}
                    onClick={() => browse(d.path)}
                  >
                    <FolderIcon className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{d.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t px-2 py-1.5">
            <span className="text-[10px] text-muted-foreground">
              Click to open, double-click to select
            </span>
            <Button
              type="button"
              size="xs"
              onClick={() => browsePath && selectFolder(browsePath)}
              disabled={!browsePath}
            >
              Select
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
