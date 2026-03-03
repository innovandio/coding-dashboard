// Old name still exported — should have been renamed to formatDateTime
export function formatDate(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

export function parseDate(input: string): Date {
  return new Date(input);
}
