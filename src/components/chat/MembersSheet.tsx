import { Search, UserPlus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Avatar, Button, Card, FieldLabel, Input, Sheet, Switch } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useSession } from "@/providers/SessionProvider";
import { supabase } from "@/supabase/client";

import type { MembersSheetProps } from "./contracts";
import type { SearchUser } from "./shared";

/** The web waited this long after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 300;

/** The rows the `search_users` RPC answered, keyed by the query they
 *  answer. "Searching" is derived (the answer's query is stale), so the
 *  debounce effect never sets state synchronously. `failed` keeps a dead
 *  network from reading as "No one found." */
type Answer = { q: string; rows: SearchUser[]; failed: boolean };

/**
 * The members sheet behind the chat header. Ported from the members Sheet
 * of reference/web-pwa/app/(app)/chat/ChatClient.tsx (around lines
 * 1210-1370) plus its state block (toggleNotifyChat, the search effect and
 * addMember, around lines 290-360).
 *
 * Differences from the web:
 * - The notify value came server-rendered (initialNotifyChat). Here it is
 *   profile.notify_chat from useSession, re-synced when the profile
 *   refreshes, and a successful write calls refreshProfile() so Settings and
 *   the rest of the app agree.
 * - A failed search or add was silent. Native says so in a footnote: a
 *   dead network must not look like an empty directory.
 */
export function MembersSheet({
  open,
  onClose,
  groupId,
  groupName,
  userId,
  isOwner,
  members,
  onMembersChange,
}: MembersSheetProps) {
  const c = useTheme();
  const { profile, refreshProfile } = useSession();

  // ── Personal notification preference (profiles.notify_chat) ──────────────
  const serverNotify = profile?.notify_chat ?? true;
  const [notifyChat, setNotifyChat] = useState(serverNotify);
  // Follow the profile when it refreshes (adjusted during render, the
  // React-sanctioned way to track a prop; same pattern as Sheet).
  const [prevServerNotify, setPrevServerNotify] = useState(serverNotify);
  if (serverNotify !== prevServerNotify) {
    setPrevServerNotify(serverNotify);
    setNotifyChat(serverNotify);
  }

  const toggleNotifyChat = async (next: boolean) => {
    setNotifyChat(next);
    const { error } = await supabase
      .from("profiles")
      .update({ notify_chat: next })
      .eq("id", userId);
    if (error) {
      setNotifyChat(!next); // revert on failure
      return;
    }
    void refreshProfile();
  };

  // ── Owner-only: add members by name or email ──────────────────────────────
  const [memberQuery, setMemberQuery] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addFailed, setAddFailed] = useState<string | null>(null);

  const q = memberQuery.trim();
  // Stale rows stay visible while the next query runs, as on the web, so
  // the list does not flash "Searching…" on every keystroke.
  const results = q ? (answer?.rows ?? []) : [];
  const searching = q !== "" && answer?.q !== q;
  const searchFailed = answer?.q === q && answer.failed;

  useEffect(() => {
    if (!isOwner || !q) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_users", { p_group_id: groupId, q });
      if (cancelled) return;
      setAnswer({ q, rows: error ? [] : ((data as SearchUser[] | null) ?? []), failed: !!error });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, isOwner, groupId]);

  const onQueryChange = (value: string) => {
    setMemberQuery(value);
    setAddFailed(null);
    // Web: results cleared when the query emptied, so the next search starts
    // from "Searching…" rather than old rows.
    if (!value.trim()) setAnswer(null);
  };

  const addMember = async (u: SearchUser) => {
    setAddingId(u.id);
    setAddFailed(null);
    const { error } = await supabase.rpc("add_group_member", {
      p_group_id: groupId,
      p_user_id: u.id,
    });
    setAddingId(null);
    if (error) {
      setAddFailed(u.id);
      return;
    }
    setAnswer((prev) =>
      prev
        ? { ...prev, rows: prev.rows.map((x) => (x.id === u.id ? { ...x, is_member: true } : x)) }
        : prev,
    );
    onMembersChange((m) =>
      m.some((x) => x.user_id === u.id)
        ? m
        : [...m, { user_id: u.id, display_name: u.display_name, avatar_url: u.avatar_url }],
    );
  };

  const count = `${members.length} ${members.length === 1 ? "member" : "members"}`;

  return (
    <Sheet open={open} onClose={onClose} dragAnywhere={false}>
      {/* The Sheet lifts itself above the keyboard and lets this ScrollView
          shrink; the grab handle still dismisses. */}
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Text numberOfLines={1} style={[Type.title2, { color: c.foreground }]}>
          {groupName}
        </Text>
        <Text style={[Type.footnote, styles.count, { color: c.muted }]}>{count}</Text>

        {/* Personal notification preference */}
        <Card style={styles.toggleRow}>
          <View style={styles.grow}>
            <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>
              Message notifications
            </Text>
            <Text style={[Type.footnote, { color: c.muted }]}>
              {notifyChat
                ? "On: you're notified for new messages."
                : "Off: only @mentions and replies notify you."}
            </Text>
          </View>
          <Switch
            value={notifyChat}
            onValueChange={toggleNotifyChat}
            accessibilityLabel="Message notifications"
          />
        </Card>

        {/* Owner-only: add members by name or email. */}
        {isOwner && (
          <View style={styles.section}>
            <FieldLabel style={styles.label}>Add member</FieldLabel>
            <View>
              <Input
                value={memberQuery}
                onChangeText={onQueryChange}
                placeholder="Search by name or email"
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                clearButtonMode="while-editing"
                accessibilityLabel="Search by name or email"
                style={styles.searchInput}
              />
              <View pointerEvents="none" style={styles.searchIcon}>
                <Search size={16} color={c.faint} />
              </View>
            </View>

            {q !== "" && (
              <View style={styles.results}>
                {searching && results.length === 0 ? (
                  <Text style={[Type.footnote, styles.note, { color: c.faint }]}>Searching…</Text>
                ) : searchFailed && results.length === 0 ? (
                  <Text style={[Type.footnote, styles.note, { color: c.danger }]}>
                    Couldn&apos;t search right now. Check your connection and try again.
                  </Text>
                ) : results.length === 0 ? (
                  <Text style={[Type.footnote, styles.note, { color: c.faint }]}>No one found.</Text>
                ) : (
                  results.map((u) => (
                    <Card key={u.id} style={styles.resultRow}>
                      <Avatar name={u.display_name || u.email} src={u.avatar_url} size={36} />
                      <View style={styles.grow}>
                        <Text
                          numberOfLines={1}
                          style={[Type.subhead, styles.medium, { color: c.foreground }]}
                        >
                          {u.display_name || "–"}
                        </Text>
                        <Text numberOfLines={1} style={[Type.caption, { color: c.faint }]}>
                          {u.email}
                        </Text>
                      </View>
                      {u.is_member ? (
                        <Text style={[Type.footnote, styles.medium, styles.added, { color: c.faint }]}>
                          Added
                        </Text>
                      ) : (
                        <Button
                          size="md"
                          disabled={addingId === u.id}
                          onPress={() => addMember(u)}
                          accessibilityLabel={`Add ${u.display_name || u.email}`}
                          style={styles.addBtn}
                        >
                          <UserPlus size={14} strokeWidth={2.5} color={c.onAccent} />
                          <Text style={[Type.footnote, styles.semibold, { color: c.onAccent }]}>
                            {addingId === u.id ? "Adding…" : "Add"}
                          </Text>
                        </Button>
                      )}
                    </Card>
                  ))
                )}
                {addFailed && (
                  <Text style={[Type.footnote, styles.note, { color: c.danger }]}>
                    Couldn&apos;t add them. Try again.
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        <FieldLabel style={styles.label}>Members</FieldLabel>
        <View style={styles.memberList}>
          {members.map((m) => (
            <Card key={m.user_id} style={styles.memberRow}>
              <Avatar name={m.display_name} src={m.avatar_url} size={40} />
              <Text
                numberOfLines={1}
                style={[Type.callout, styles.medium, styles.grow, { color: c.foreground }]}
              >
                {m.display_name}
                {m.user_id === userId && <Text style={{ color: c.faint }}> (You)</Text>}
              </Text>
            </Card>
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  // Web: px-5 pt-2.
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  count: { marginTop: 2, marginBottom: 16 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    marginBottom: 16,
  },
  section: { marginBottom: 16 },
  label: { paddingHorizontal: 4 },
  // Room for the 16px glyph at left 14 plus a gap (web: pl-9).
  searchInput: { paddingLeft: 40 },
  searchIcon: {
    position: "absolute",
    left: 14,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  results: { marginTop: 8, gap: 6 },
  note: { paddingHorizontal: 4, paddingVertical: 8 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10 },
  added: { paddingHorizontal: 8 },
  addBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, gap: 4 },
  memberList: { gap: 8 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  grow: { flex: 1, minWidth: 0 },
  semibold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
});
