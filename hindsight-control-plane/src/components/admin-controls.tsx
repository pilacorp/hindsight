"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type ButtonVariant = React.ComponentProps<typeof Button>["variant"];

/** A button that opens a styled confirm dialog before running the action. */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "destructive",
  size = "sm",
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: ButtonVariant;
  size?: React.ComponentProps<typeof Button>["size"];
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size={size} variant={variant}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Copies text to the clipboard with a toast and a transient check icon. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy — select and copy manually");
        }
      }}
    >
      {copied ? (
        <Check className="mr-1.5 h-4 w-4" aria-hidden />
      ) : (
        <Copy className="mr-1.5 h-4 w-4" aria-hidden />
      )}
      {label}
    </Button>
  );
}
