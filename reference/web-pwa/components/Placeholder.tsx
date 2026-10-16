import { type LucideIcon } from "lucide-react";

/** On-brand stub for screens being built in a later step. */
export function Placeholder({
  icon: Icon,
  title,
  note,
}: {
  icon: LucideIcon;
  title: string;
  note: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="px-5 pt-7 pb-3">
        <h1 className="text-display">{title}</h1>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-accent-tint text-accent">
          <Icon className="size-7" strokeWidth={2} />
        </div>
        <p className="mt-4 max-w-xs text-callout text-muted">{note}</p>
      </div>
    </div>
  );
}
