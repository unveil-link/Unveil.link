"use client";
import { useState } from "react";
import { Button, useToast, CopyIcon } from "@/components/ui";
import { CheckIcon } from "@/components/ui";
import { copyText, shareUrl } from "@/lib/share";

export function CopyLinkButton({ linkId, size = "sm", variant = "secondary", label = "Copy link", className }: { linkId: string; size?: "sm" | "md"; variant?: "secondary" | "ghost" | "primary"; label?: string; className?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      onClick={async () => {
        const ok = await copyText(shareUrl(linkId));
        if (ok) {
          setCopied(true);
          toast("Link copied to clipboard");
          setTimeout(() => setCopied(false), 2000);
        } else toast("Couldn’t copy — select the link and copy it manually.", "danger");
      }}
    >
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}
