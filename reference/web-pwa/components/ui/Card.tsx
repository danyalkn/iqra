import { cn } from "@/lib/cn";

type Props = React.HTMLAttributes<HTMLDivElement> & {
  as?: "div" | "section" | "article";
};

/** Surface card with hairline-soft elevation, matching the design tokens. */
export function Card({ as: Tag = "div", className, ...rest }: Props) {
  return (
    <Tag
      className={cn("rounded-2xl bg-surface p-4 shadow-e1", className)}
      {...rest}
    />
  );
}
