"use client";

import { useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOpenAILoginStream } from "@/hooks/use-openai-login-stream";
import { ExternalLink, Loader2, CheckCircle2, XCircle } from "lucide-react";

export function OpenAILoginDialog({
  open,
  onLoginComplete,
}: {
  open: boolean;
  onLoginComplete: () => void;
}) {
  const { loginState, exitCode, oauthUrl } = useOpenAILoginStream(open);

  // Auto-close 2s after successful exit
  useEffect(() => {
    if (loginState === "exited" && exitCode === 0) {
      const timer = setTimeout(onLoginComplete, 2000);
      return () => clearTimeout(timer);
    }
  }, [loginState, exitCode, onLoginComplete]);

  const handleOpenLogin = useCallback(() => {
    if (oauthUrl) window.open(oauthUrl, "_blank");
  }, [oauthUrl]);

  return (
    <Dialog
      open={open}
      onOpenChange={() => {
        /* prevent accidental close */
      }}
    >
      <DialogContent
        className="sm:max-w-md flex flex-col gap-4 p-6"
        showCloseButton={loginState === "exited"}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">OpenAI Login</DialogTitle>
          <DialogDescription className="text-xs">
            Sign in with your OpenAI account to use Codex models with your Plus subscription.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {loginState === "exited" && exitCode === 0 ? (
            <>
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-sm text-muted-foreground">Login successful. Closing...</p>
            </>
          ) : loginState === "exited" ? (
            <>
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-muted-foreground">Login failed. Please try again.</p>
            </>
          ) : loginState === "exchanging" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Completing login...
            </div>
          ) : oauthUrl ? (
            <>
              <Button onClick={handleOpenLogin} className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Sign in with OpenAI
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Sign in and authorize access. You&apos;ll be redirected back automatically.
              </p>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Preparing login...
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
