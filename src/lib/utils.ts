import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Strip ANSI escape sequences (SGR, cursor movement, DEC private mode, OSC, etc.) */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]|\x1B\][^\x07]*\x07|\x1B[()][A-Z0-9]|\x1B\[[\?]?[0-9;]*[hl]/g, "");
}
