"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Inbox, Bell, Trash2, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { deleteEntry, markEntriesChanged } from "@/lib/entryWrites";
import type { GroupMember, LogRow } from "@/lib/types";
import {
  localDate,
  todayLocal,
  timeLabel,
  dayLabel,
  lastNDaysEndingOn,
} from "@/lib/dates";
import { describeEntry, quantityLabel } from "@/lib/format";
import { groupFeed, type FeedCard } from "@/lib/feedGroups";
import { pagesPhrase } from "@/lib/position";
import { ENTRY_META } from "@/lib/entries";
import { NUDGE_COOLDOWN_MS } from "@/lib/nudges";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";

export function FeedClient({
  groupId,
  groupName,
  tz,
  userId,
  members,
  initialEntries,
  recentNudges,
  renderedAt,
}: {
  groupId: string;
  groupName: string;
  tz: string;
  userId: string;
  members: GroupMember[];
  initialEntries: LogRow[];
  /** to_user -> ISO time of my last nudge still inside the cooldown. */
  recentNudges: Record<string, string>;
  /** Server clock at render, so the first client render matches SSR. */
  renderedAt: number;
}) {
  const [entries, setEntries] = useState<LogRow[]>(initialEntries);
  // to_user -> ms timestamp of my last nudge to them.
  const [nudgedAt, setNudgedAt] = useState<Map<string, number>>(
    () =>
      new Map(
        Object.entries(recentNudges).map(([u, at]) => [u, Date.parse(at)]),
      ),
  );
  const [now, setNow] = useState(renderedAt);
  const cooldownLeft = (toUser: string) =>
    Math.max(0, (nudgedAt.get(toUser) ?? 0) + NUDGE_COOLDOWN_MS - now);
  const anyCoolingDown = [...nudgedAt.values()].some(
    (at) => at + NUDGE_COOLDOWN_MS > now,
  );

  // Tick once a second while any Nudge button is cooling down, so it shows
  // the countdown and re-enables itself.
  useEffect(() => {
    if (!anyCoolingDown) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyCoolingDown]);

  const nudge = async (toUser: string) => {
    // Click handler, not render; the compiler can't tell and flags it.
    // eslint-disable-next-line react-hooks/purity
    const at = Date.now();
    setNow(at);
    setNudgedAt((prev) => new Map(prev).set(toUser, at));
    const supabase = createClient();
    const { error } = await supabase.from("nudges").insert({
      group_id: groupId,
      from_user: userId,
      to_user: toUser,
      kind: "log_reminder",
    });
    if (error) {
      setNudgedAt((prev) => {
        const n = new Map(prev);
        if (n.get(toUser) === at) n.delete(toUser);
        return n;
      });
    }
  };

  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.user_id, m])),
    [members],
  );

  // Deleting your own entries: the first tap arms the button ("Delete"),
  // the second removes the entry. It disarms itself after a few seconds.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const removeEntry = async (id: string) => {
    setConfirming(null);
    setDeleteError(null);
    const removed = entries.find((e) => e.id === id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    const err = await deleteEntry(id);
    if (err) {
      // Put it back where it was (newest first).
      if (removed) {
        setEntries((prev) =>
          [...prev, removed].sort((a, b) =>
            a.logged_at < b.logged_at ? 1 : a.logged_at > b.logged_at ? -1 : 0,
          ),
        );
      }
      setDeleteError(err);
      return;
    }
    // Today may come back from the router cache with the old list.
    markEntriesChanged();
  };

  // Live-update the feed when anyone logs (in-app only - no push for feed).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`feed-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "log_entries",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const row = payload.new as LogRow;
          setEntries((prev) =>
            prev.some((e) => e.id === row.id) ? prev : [row, ...prev],
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);

  const today = todayLocal(tz);
  const loggedTodayIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      if (localDate(e.logged_at, tz) === today) s.add(e.user_id);
    }
    return s;
  }, [entries, tz, today]);

  // One card per person per day, same-type entries merged into one line
  // (src/lib/feedGroups.ts). Cards open up to show the individual entries.
  // The feed loads the last 30×24 hours, so its oldest local day is cut
  // part-way; with day totals on each card that would show a wrong total.
  // Keep only whole days (the last 30 calendar days, today included).
  const days = useMemo(() => {
    const floor = lastNDaysEndingOn(today, 30)[0];
    return groupFeed(entries, tz).filter((d) => d.ymd >= floor);
  }, [entries, tz, today]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleCard = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const yesterday = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString("en-CA");
  })();

  const dayHeading = (ymd: string) =>
    ymd === today ? "Today" : ymd === yesterday ? "Yesterday" : dayLabel(ymd);

  const loggedCount = loggedTodayIds.size;
  const notLogged = members.filter(
    (m) => m.user_id !== userId && !loggedTodayIds.has(m.user_id),
  );

  return (
    <div className="flex h-full flex-col">
      <header className="px-5 pt-7 pb-3">
        <p className="text-footnote font-medium uppercase tracking-wider text-faint">
          {groupName} · {members.length}{" "}
          {members.length === 1 ? "member" : "members"}
        </p>
        <h1 className="mt-1 text-display">Feed</h1>
      </header>

      {/* Logged-today strip */}
      <div className="px-5">
        <div className="rounded-2xl bg-surface p-4 shadow-e1">
          <p className="text-footnote font-medium text-muted">Logged today</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {members.map((m) => {
              const on = loggedTodayIds.has(m.user_id);
              return (
                <div key={m.user_id} className="relative">
                  <Avatar
                    name={m.display_name}
                    src={m.avatar_url}
                    size={44}
                    className={cn(!on && "opacity-50")}
                  />
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full ring-2 ring-surface",
                      on ? "bg-accent text-on-accent" : "bg-surface-2",
                    )}
                  >
                    {on && <Check className="size-2.5" strokeWidth={4} />}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-footnote text-faint">
            {loggedCount} of {members.length} logged today
          </p>

          {notLogged.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {notLogged.map((m) => {
                const first = m.display_name.split(" ")[0];
                const left = cooldownLeft(m.user_id);
                const done = left > 0;
                return (
                  <button
                    key={m.user_id}
                    onClick={() => !done && nudge(m.user_id)}
                    disabled={done}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-footnote font-medium transition-colors",
                      done
                        ? "bg-surface-2 text-faint"
                        : "bg-accent-tint text-accent active:scale-95",
                    )}
                  >
                    {done ? (
                      <>
                        <Check className="size-3.5" strokeWidth={3} /> Nudged{" "}
                        {first} · {Math.ceil(left / 1000)}s
                      </>
                    ) : (
                      <>
                        <Bell className="size-3.5" /> Nudge {first}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Feed */}
      <div className="mt-5 flex-1 space-y-5 overflow-y-auto px-5 pb-6">
        {deleteError && (
          <p className="rounded-lg bg-danger-tint px-3 py-2 text-footnote text-danger">
            {deleteError}
          </p>
        )}
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 pt-12 text-center">
            <div className="grid size-16 place-items-center rounded-2xl bg-accent-tint text-accent">
              <Inbox className="size-7" strokeWidth={2} />
            </div>
            <p className="mt-4 text-callout font-semibold">No activity yet</p>
            <p className="mt-1 max-w-xs text-footnote text-muted">
              When your circle logs, it shows up here. Be the first today.
            </p>
          </div>
        ) : (
          days.map(({ ymd, cards }) => (
            <div key={ymd}>
              <p className="mb-2 px-1 text-footnote font-medium uppercase tracking-wider text-faint">
                {dayHeading(ymd)}
              </p>
              <div className="space-y-2.5">
                {cards.map((card) => {
                  const key = `${ymd}:${card.user_id}`;
                  return (
                    <FeedCardView
                      key={key}
                      card={card}
                      member={memberMap.get(card.user_id)}
                      isMe={card.user_id === userId}
                      tz={tz}
                      expanded={open.has(key)}
                      onToggle={() => toggleCard(key)}
                      confirming={confirming}
                      onDelete={(id) =>
                        confirming === id ? removeEntry(id) : setConfirming(id)
                      }
                    />
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** One person's day: a line per entry type, the day's pages in the corner,
 *  and the individual entries (with delete, for your own) underneath. */
function FeedCardView({
  card,
  member,
  isMe,
  tz,
  expanded,
  onToggle,
  confirming,
  onDelete,
}: {
  card: FeedCard;
  member: GroupMember | undefined;
  isMe: boolean;
  tz: string;
  expanded: boolean;
  onToggle: () => void;
  confirming: string | null;
  onDelete: (id: string) => void;
}) {
  const name = isMe ? "You" : (member?.display_name ?? "Member");
  const single = card.entries.length === 1;
  const only = card.entries[0];
  return (
    <div className="rounded-2xl bg-surface p-3.5 shadow-e1">
      <div className="flex items-start gap-3">
        <Avatar
          name={member?.display_name ?? "Member"}
          src={member?.avatar_url}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-callout font-semibold">{name}</span>
            <span className="shrink-0 text-caption text-faint tabular-nums">
              · {timeLabel(card.latestAt, tz)}
            </span>
            {card.pages > 0 && (
              <span className="ml-auto shrink-0 text-caption font-medium text-muted tabular-nums">
                {pagesPhrase(card.pages)}
              </span>
            )}
          </div>
          <div className="mt-1.5 space-y-1">
            {card.lines.map((line) => (
              <div key={line.type} className="flex items-center gap-2">
                {/* Fixed width so every line's text starts in one column. */}
                <Badge type={line.type} className="w-[5.5rem] shrink-0 justify-center" />
                <span className="truncate text-footnote text-muted">{line.text}</span>
              </div>
            ))}
          </div>

          {!single && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="mt-2 inline-flex items-center gap-1 text-caption font-medium text-accent"
            >
              {expanded ? "Hide entries" : `Show ${card.entries.length} entries`}
              <ChevronDown
                className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
              />
            </button>
          )}
        </div>
        {single && isMe && (
          <DeleteButton
            id={only.id}
            confirming={confirming === only.id}
            onClick={() => onDelete(only.id)}
          />
        )}
      </div>

      {!single && expanded && (
        <div className="mt-2.5 divide-y divide-border border-t border-border pl-[3.25rem]">
          {card.entries.map((e) => {
            const amt = quantityLabel(e);
            return (
              <div key={e.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-caption text-faint tabular-nums">
                    {timeLabel(e.logged_at, tz)} · {ENTRY_META[e.entry_type].label}
                  </p>
                  <p className="truncate text-footnote text-foreground">
                    {describeEntry(e)}
                    {amt ? <span className="text-muted"> · {amt}</span> : null}
                  </p>
                </div>
                {isMe && (
                  <DeleteButton
                    id={e.id}
                    confirming={confirming === e.id}
                    onClick={() => onDelete(e.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Two-tap delete: a trash icon, then a red "Delete" to confirm. */
function DeleteButton({
  id,
  confirming,
  onClick,
}: {
  id: string;
  confirming: boolean;
  onClick: () => void;
}) {
  if (id.startsWith("temp-")) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={confirming ? "Tap again to delete this entry" : "Delete entry"}
      className={cn(
        "shrink-0 rounded-full transition-colors",
        confirming
          ? "bg-danger px-3 py-1.5 text-footnote font-semibold text-white"
          : "grid size-8 place-items-center text-faint hover:bg-danger-tint hover:text-danger",
      )}
    >
      {confirming ? "Delete" : <Trash2 className="size-4" />}
    </button>
  );
}
