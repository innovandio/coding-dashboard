"use client";

import { useState, useCallback } from "react";
import type { ApiResult } from "@/lib/api-client";

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApi<T>(fetcher: () => Promise<ApiResult<T>>) {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const result = await fetcher();
    if (result.ok) {
      setState({ data: result.data, loading: false, error: null });
    } else {
      setState({ data: null, loading: false, error: result.error });
    }
    return result;
  }, [fetcher]);

  return { ...state, execute };
}
