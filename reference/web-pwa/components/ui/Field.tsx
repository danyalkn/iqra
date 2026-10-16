import { forwardRef } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/cn";

export function FieldLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "mb-2 text-footnote font-medium uppercase tracking-wider text-faint",
        className,
      )}
    >
      {children}
    </p>
  );
}

const inputBase =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-callout text-foreground " +
  "placeholder:text-faint outline-none transition focus:border-accent " +
  "focus:ring-2 focus:ring-accent/20";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(inputBase, className)} {...rest} />;
});

/** Native time field in the app's bordered frame (clock glyph + input).
 *  Value is "HH:MM". */
export function TimeInput({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5">
      <Clock className="size-4 text-faint" />
      <input
        type="time"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent text-callout text-foreground outline-none disabled:opacity-40"
      />
    </div>
  );
}

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(inputBase, "min-h-[88px] resize-none", className)}
      {...rest}
    />
  );
});
