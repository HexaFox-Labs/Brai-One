import * as React from "react";

import { cn } from "@/lib/cn";

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-32 w-full resize-y rounded-[10px] border border-border-strong bg-input px-3.5 py-3 text-base leading-6 text-foreground outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted focus-visible:border-accent-focus focus-visible:ring-2 focus-visible:ring-accent-ring/35 disabled:cursor-not-allowed disabled:opacity-60 md:text-sm",
        "aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/25",
        className,
      )}
      {...props}
    />
  );
}
