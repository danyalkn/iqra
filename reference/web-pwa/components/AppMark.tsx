import { BookOpen } from "lucide-react";
import { cn } from "@/lib/cn";

/** The Iqra brand mark - open book on the accent, matching the app icon. */
export function AppMark({
  size = 64,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-[20px] bg-accent text-on-accent shadow-e2",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <BookOpen style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} />
    </div>
  );
}
