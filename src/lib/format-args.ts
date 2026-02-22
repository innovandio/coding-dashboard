export function formatArgsSummary(name: string, args: Record<string, unknown>): string {
  const n = name.toLowerCase();
  switch (n) {
    case "exec":
    case "bash":
      return truncate(String(args.command ?? ""), 80);
    case "read":
    case "write":
    case "edit":
      return truncate(String(args.file_path ?? ""), 80);
    case "grep":
    case "glob":
      return truncate(String(args.pattern ?? ""), 80);
    case "memory_search":
      return truncate(String(args.query ?? ""), 80);
    case "memory_add":
      return truncate(String(args.content ?? args.text ?? ""), 80);
    case "task":
      return truncate(String(args.prompt ?? args.description ?? ""), 80);
    case "websearch":
      return truncate(String(args.query ?? ""), 80);
    case "webfetch":
      return truncate(String(args.url ?? ""), 80);
    default: {
      const entries = Object.entries(args);
      if (entries.length === 0) return "";
      const [key, val] = entries[0];
      return truncate(`${key}: ${String(val)}`, 80);
    }
  }
}

export function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "...";
}
