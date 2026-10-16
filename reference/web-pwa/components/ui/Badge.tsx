import { cn } from "@/lib/cn";
import { ENTRY_META, type EntryType } from "@/lib/entries";

/** Entry-type badge. New bucket = accent tint, Revision = neutral - keeps the
 *  one-accent discipline (accent only ever means "new"). */
export function Badge({
  type,
  className,
}: {
  type: EntryType;
  className?: string;
}) {
  const meta = ENTRY_META[type];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-caption font-medium tracking-wide",
        meta.bucket === "new"
          ? "bg-accent-tint text-accent"
          : "bg-surface-2 text-muted",
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
