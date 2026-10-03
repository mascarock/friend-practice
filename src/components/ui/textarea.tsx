import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[88px] w-full rounded-md border border-[#d7ccb8] bg-white px-3 py-2 text-sm text-[#1f1a14] placeholder:text-[#8a8176] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f1a14]/20",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";
