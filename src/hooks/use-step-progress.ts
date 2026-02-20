"use client";

import { useState, useRef, useCallback } from "react";
import type { StepStatus, ProgressEvent, StepEvent, DoneEvent } from "@/lib/ndjson-stream";

export interface StepState {
  label: string;
  status: StepStatus;
  error?: string;
}

export function useStepProgress() {
  const [steps, setSteps] = useState<StepState[]>([]);
  const [done, setDone] = useState(false);
  const [success, setSuccess] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setSteps([]);
    setDone(false);
    setSuccess(false);
    setGlobalError(null);
  }, []);

  const start = useCallback(async (url: string, init?: RequestInit) => {
    // Abort any previous stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    reset();

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body.error) message = body.error;
        } catch {}
        setGlobalError(message);
        setDone(true);
        setSuccess(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setGlobalError("No response stream");
        setDone(true);
        setSuccess(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event: ProgressEvent = JSON.parse(line);
            if ("done" in event && (event as DoneEvent).done) {
              const doneEvt = event as DoneEvent;
              setDone(true);
              setSuccess(doneEvt.success);
              if (doneEvt.error && !doneEvt.success) {
                setGlobalError(doneEvt.error);
              }
            } else {
              const stepEvt = event as StepEvent;
              setSteps((prev) => {
                const next = [...prev];
                // Grow array if needed
                while (next.length <= stepEvt.step) {
                  next.push({ label: "", status: "pending" });
                }
                next[stepEvt.step] = {
                  label: stepEvt.label ?? next[stepEvt.step].label,
                  status: stepEvt.status,
                  error: stepEvt.error,
                };
                return next;
              });
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setGlobalError(err instanceof Error ? err.message : "Network error");
      setDone(true);
      setSuccess(false);
    }
  }, [reset]);

  // Cleanup on unmount
  const cleanup = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { steps, done, success, globalError, start, reset, cleanup };
}
