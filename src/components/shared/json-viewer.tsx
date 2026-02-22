"use client";

import { useState } from "react";

function JsonNode({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (value === null || value === undefined) {
    return (
      <div className="flex gap-1" style={{ paddingLeft: depth * 16 }}>
        {name && <span className="text-blue-400">{name}:</span>}
        <span className="text-muted-foreground italic">null</span>
      </div>
    );
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div style={{ paddingLeft: depth * 16 }}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 hover:text-foreground text-muted-foreground"
        >
          <span className="text-xs">{expanded ? "▼" : "▶"}</span>
          {name && <span className="text-blue-400">{name}</span>}
          <span className="text-muted-foreground text-xs">{`{${entries.length}}`}</span>
        </button>
        {expanded &&
          entries.map(([k, v]) => <JsonNode key={k} name={k} value={v} depth={depth + 1} />)}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div style={{ paddingLeft: depth * 16 }}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 hover:text-foreground text-muted-foreground"
        >
          <span className="text-xs">{expanded ? "▼" : "▶"}</span>
          {name && <span className="text-blue-400">{name}</span>}
          <span className="text-muted-foreground text-xs">[{value.length}]</span>
        </button>
        {expanded &&
          value.map((item, i) => (
            <JsonNode key={i} name={String(i)} value={item} depth={depth + 1} />
          ))}
      </div>
    );
  }

  const displayValue =
    typeof value === "string" ? (
      <span className="text-green-400">&quot;{value}&quot;</span>
    ) : typeof value === "number" ? (
      <span className="text-yellow-400">{String(value)}</span>
    ) : typeof value === "boolean" ? (
      <span className="text-purple-400">{String(value)}</span>
    ) : (
      <span>{String(value)}</span>
    );

  return (
    <div className="flex gap-1" style={{ paddingLeft: depth * 16 }}>
      {name && <span className="text-blue-400">{name}:</span>}
      {displayValue}
    </div>
  );
}

export function JsonViewer({ data }: { data: unknown }) {
  return (
    <div className="font-mono text-xs overflow-auto">
      <JsonNode value={data} depth={0} />
    </div>
  );
}
