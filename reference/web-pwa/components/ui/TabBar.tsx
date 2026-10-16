"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck,
  Users,
  ChartColumnBig,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useSwipeDownDismiss } from "@/lib/useSwipeDownDismiss";

const TABS = [
  { href: "/today", label: "Today", icon: CalendarCheck },
  { href: "/feed", label: "Feed", icon: Users },
  { href: "/stats", label: "Stats", icon: ChartColumnBig },
  { href: "/chat", label: "Chat", icon: MessageCircle },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const swipeDown = useSwipeDownDismiss();
  return (
    <nav
      {...swipeDown}
      className="flex items-center justify-around border-t border-border bg-surface px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-2.5"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-0 transition-colors",
              active ? "text-accent" : "text-faint hover:text-muted",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-5" strokeWidth={active ? 2.25 : 2} />
            <span className="text-[10px] font-medium leading-tight">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
