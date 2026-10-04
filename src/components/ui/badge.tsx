import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "neutral",
  children,
}: {
  className?: string;
  tone?: "neutral" | "sample" | "locked" | "ok" | "over" | "local";
  children: ReactNode;
}) {
  const tones = {
    neutral: "border-neutral-600 text-neutral-300",
    sample: "border-neutral-300 text-white",
    locked: "border-neutral-600 text-neutral-300",
    ok: "border-neutral-300 text-white",
    over: "border-neutral-300 text-white",
    local: "border-neutral-600 text-neutral-300",
  };

  return (
    <span className={cn("inline-flex shrink-0 items-center border px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest", tones[tone], className)}>
      {children}
    </span>
  );
}
