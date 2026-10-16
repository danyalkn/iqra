import { Users } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/ui";
import { Elevation, Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { GroupMember } from "@/lib/types";

type Props = {
  /** null = the "@all" entry, listed first while the query could still be it. */
  suggestions: (GroupMember | null)[];
  /** The highlighted row. The web cycled it with the arrow keys; a phone
   *  keyboard has none, so the composer always passes 0 and any row is a tap. */
  activeIdx: number;
  onPick: (member: GroupMember | null) => void;
};

/**
 * The @mention typeahead, floating above the composer bar. Ported from the
 * "Mention typeahead" block of reference/web-pwa/app/(app)/chat/ChatClient.tsx
 * (around line 1635). It positions itself: render it inside the composer
 * root, which is the bar it hangs over.
 *
 * Rows pick on press-in, the web's onMouseDown + preventDefault: the field
 * never loses focus, so the keyboard stays up and the caret can be placed
 * after the inserted name. A native Pressable does not steal focus from a
 * TextInput anyway, but press-in also beats the keyboard-dismiss pan that
 * wraps the composer. At most five rows, so no scroll container is needed.
 */
export function MentionSuggestions({ suggestions, activeIdx, onPick }: Props) {
  const c = useTheme();
  if (suggestions.length === 0) return null;
  return (
    // Shadow on the outer view, clip on the inner: overflow hidden on the
    // shadow view would clip the iOS shadow (same split as Sheet).
    <View
      style={[styles.panel, Elevation.e3, { backgroundColor: c.surface, borderColor: c.border }]}
    >
      <View style={styles.clip}>
        {suggestions.map((s, i) => (
          <Pressable
            key={s?.user_id ?? "@all"}
            accessibilityRole="button"
            accessibilityLabel={s ? `Mention ${s.display_name}` : "Mention everyone"}
            onPressIn={() => onPick(s)}
            style={[styles.row, i === activeIdx && { backgroundColor: c.accentTint }]}
          >
            {s ? (
              <>
                <Avatar name={s.display_name} src={s.avatar_url} size={28} />
                <Text
                  numberOfLines={1}
                  style={[Type.callout, styles.name, { color: c.foreground }]}
                >
                  {s.display_name}
                </Text>
              </>
            ) : (
              <>
                <View style={[styles.allIcon, { backgroundColor: c.accentTint }]}>
                  <Users size={16} color={c.accent} />
                </View>
                <Text style={[Type.callout, styles.name, { color: c.foreground }]}>@all</Text>
                <Text numberOfLines={1} style={[Type.footnote, styles.hint, { color: c.faint }]}>
                  Everyone in the circle
                </Text>
              </>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    // Web: absolute bottom-full left-3 right-3 mb-2.
    bottom: "100%",
    left: 12,
    right: 12,
    marginBottom: 8,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  clip: { borderRadius: Radius.md, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  name: { fontWeight: "500", flexShrink: 1 },
  hint: { flexShrink: 1 },
  allIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
