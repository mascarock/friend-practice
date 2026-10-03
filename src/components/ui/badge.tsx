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
    neutral: "bg-[#efe7d8] text-[#3a3228]",
    sample: "bg-[#f3d2b0] text-[#7a3e0c] border border-[#e09a55]",
    locked: "bg-[#f0e4c4] text-[#6d5420] border border-[#d9c48a]",
    ok: "bg-[#d8eee3] text-[#1f5c45] border border-[#9cc9b4]",
    over: "bg-[#f6d6d6] text-[#9b2c2c] border border-[#e3a2a2]",
    local: "bg-[#1f1a14] text-[#f4efe6]",
  };

  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}
