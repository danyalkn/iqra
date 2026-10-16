import {
  Sparkles,
  BookMarked,
  History,
  BookOpen,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import type { EntryType } from "@/lib/entries";

/** Icon per entry type - used in the speed-dial and entry rows. */
export const ENTRY_ICON: Record<EntryType, LucideIcon> = {
  sabak: Sparkles,
  sabak_para: BookMarked,
  dor: History,
  reading: BookOpen,
  revising: RefreshCw,
};
