"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ModelConfigForm,
  isModelConfigValid,
  emptyModelConfig,
  type ModelConfigState,
} from "@/components/shared/model-config-form";
import { StepProgressDialog } from "@/components/shared/step-progress-dialog";
import { useStepProgress } from "@/hooks/use-step-progress";

export function SetupDialog({
  open,
  onSetupComplete,
}: {
  open: boolean;
  onSetupComplete: () => void;
}) {
  const [step, setStep] = useState<"config" | "completing">("config");
  const [modelConfig, setModelConfig] = useState<ModelConfigState>(emptyModelConfig);
  const [configSaving, setConfigSaving] = useState(false);

  const progress = useStepProgress();

  // Cleanup abort controller on unmount
  useEffect(() => progress.cleanup, [progress.cleanup]);

  // Open dashboard URL as soon as it arrives (mid-stream, before polling finishes)
  const [dashboardOpened, setDashboardOpened] = useState(false);
  useEffect(() => {
    const url = progress.resultData?.dashboardUrl as string | undefined;
    if (url && !dashboardOpened) {
      window.open(url, "_blank");
      setDashboardOpened(true);
    }
  }, [progress.resultData, dashboardOpened]);

  // Auto-close dialog after completion
  useEffect(() => {
    if (progress.done && progress.success) {
      const timer = setTimeout(onSetupComplete, 1500);
      return () => clearTimeout(timer);
    }
  }, [progress.done, progress.success, onSetupComplete]);

  async function handleSaveAndComplete() {
    setConfigSaving(true);
    try {
      const res = await fetch("/api/model-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modelConfig),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[setup] Model config failed:", data.error);
        return;
      }
      // Model saved — start post-setup actions
      setStep("completing");
      progress.start("/api/setup/complete", { method: "POST" });
    } catch (err) {
      console.error("[setup] Model config request failed:", err);
    } finally {
      setConfigSaving(false);
    }
  }

  function handleProgressClose() {
    if (progress.success) {
      onSetupComplete();
    } else {
      // Allow retry — go back to config step
      setStep("config");
      progress.reset();
    }
  }

  return (
    <>
      <Dialog
        open={open && step === "config"}
        onOpenChange={() => {
          /* prevent accidental close */
        }}
      >
        <DialogContent
          className="sm:max-w-sm p-4"
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-sm">OpenClaw Setup</DialogTitle>
            <DialogDescription className="text-xs">
              Configure the AI model provider to get started.
            </DialogDescription>
          </DialogHeader>

          <ModelConfigForm
            value={modelConfig}
            onChange={setModelConfig}
            disabled={configSaving}
          />
          <Button
            className="w-full"
            disabled={!isModelConfigValid(modelConfig) || configSaving}
            onClick={handleSaveAndComplete}
          >
            {configSaving ? "Saving..." : "Save & Complete Setup"}
          </Button>
        </DialogContent>
      </Dialog>

      <StepProgressDialog
        open={open && step === "completing"}
        title="Completing Setup"
        steps={progress.steps}
        done={progress.done}
        success={progress.success}
        globalError={progress.globalError}
        onClose={handleProgressClose}
      />
    </>
  );
}
