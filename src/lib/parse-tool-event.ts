/**
 * Normalize the inconsistent field names that gateways use for tool events.
 */
export interface ParsedToolEvent {
  toolName: string;
  toolUseId: string;
  status: string | undefined;
  args: Record<string, unknown> | undefined;
  result: unknown | null;
  isError: boolean;
}

export function parseToolEvent(data: Record<string, unknown>): ParsedToolEvent {
  return {
    toolName: ((data.tool_name ?? data.name ?? data.tool) as string) ?? "tool",
    toolUseId: ((data.tool_use_id ?? data.id ?? data.toolUseId) as string) ?? "",
    status: (data.status ?? data.state) as string | undefined,
    args: (data.args ?? data.input ?? data.params) as Record<string, unknown> | undefined,
    result: data.result ?? data.output ?? null,
    isError: (data.isError as boolean | undefined) === true,
  };
}

export function isToolComplete(status: string | undefined, result: unknown | null): boolean {
  return status === "done" || status === "complete" || status === "completed" || result != null;
}
