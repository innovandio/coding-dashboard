"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Circle, Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { StepState } from "@/hooks/use-step-progress";

interface StepProgressDialogProps {
  open: boolean;
  title: string;
  steps: StepState[];
  done: boolean;
  success: boolean;
  globalError: string | null;
  onClose: () => void;
}

function StepIcon({ status }: { status: StepState["status"] }) {
  switch (status) {
    case "pending":
      return <Circle className="size-4 text-muted-foreground" />;
    case "processing":
      return <Loader2 className="size-4 text-blue-500 animate-spin" />;
    case "success":
      return <CheckCircle2 className="size-4 text-green-500" />;
    case "error":
      return <XCircle className="size-4 text-destructive" />;
  }
}

export function StepProgressDialog({
  open,
  title,
  steps,
  done,
  success,
  globalError,
  onClose,
}: StepProgressDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && done) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (!done) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!done) e.preventDefault();
        }}
        className="max-w-sm"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="mt-0.5 shrink-0">
                <StepIcon status={step.status} />
              </div>
              <div className="min-w-0">
                <p className="text-sm">{step.label}</p>
                {step.error && <p className="text-xs text-destructive mt-0.5">{step.error}</p>}
              </div>
            </div>
          ))}
        </div>

        {globalError && !steps.some((s) => s.status === "error") && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {globalError}
          </div>
        )}

        {done && (
          <DialogFooter>
            <Button size="sm" onClick={onClose}>
              {success ? "Done" : "Close"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
