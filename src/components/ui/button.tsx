import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-normal text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-neutral-100 text-neutral-950 hover:bg-white",
        secondary: "border border-neutral-600 bg-neutral-200 text-neutral-950 hover:bg-white",
        outline: "border border-neutral-600 bg-transparent text-neutral-100 hover:border-neutral-200 hover:bg-neutral-900",
        ghost: "text-neutral-400 hover:text-white hover:bg-neutral-900",
        danger: "border border-neutral-300 bg-transparent text-white hover:bg-neutral-900",
      },
      size: {
        default: "min-h-11 px-5 py-3",
        sm: "min-h-9 px-3 py-2 text-xs",
        lg: "h-11 px-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
