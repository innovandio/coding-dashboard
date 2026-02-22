"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "bg-card border-border text-foreground text-xs",
          description: "text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
