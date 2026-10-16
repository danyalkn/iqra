"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
};

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent shadow-e2 hover:bg-accent-hover active:scale-[0.98]",
  secondary:
    "bg-surface-2 text-foreground hover:bg-border/60 active:scale-[0.98]",
  ghost: "text-accent hover:bg-accent-tint active:scale-[0.98]",
  danger:
    "bg-danger text-white shadow-e2 hover:opacity-90 active:scale-[0.98]",
};

const SIZES: Record<Size, string> = {
  md: "py-2.5 px-4 text-subhead rounded-lg",
  lg: "py-3.5 px-5 text-callout rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = "primary",
    size = "lg",
    loading = false,
    fullWidth = false,
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition",
        "disabled:pointer-events-none disabled:opacity-50",
        "motion-reduce:active:scale-100",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});
