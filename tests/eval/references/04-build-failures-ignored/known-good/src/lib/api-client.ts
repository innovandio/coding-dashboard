export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  status: number;
}

export type ApiResult<T> = ApiSuccess<T> | ApiError;

export interface User {
  id: number;
  email: string;
  name: string;
}

export interface Note {
  id: number;
  title: string;
  content: string;
}

export interface Settings {
  theme: "light" | "dark";
  language: string;
  notifications: boolean;
}

async function apiRequest<T>(url: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        error: body || response.statusText,
        status: response.status,
      };
    }

    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: 0,
    };
  }
}

export function getUsers(): Promise<ApiResult<User[]>> {
  return apiRequest<User[]>("/api/users");
}

export function getNotes(): Promise<ApiResult<Note[]>> {
  return apiRequest<Note[]>("/api/notes");
}

export function getSettings(): Promise<ApiResult<Settings>> {
  return apiRequest<Settings>("/api/settings");
}

export function updateSettings(settings: Partial<Settings>): Promise<ApiResult<Settings>> {
  return apiRequest<Settings>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}
