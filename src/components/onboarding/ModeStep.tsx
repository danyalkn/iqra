import { BookMarked, BookOpen, Check } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Elevation, Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { Mode } from "@/lib/entries";

/** Same two cards as reference/web-pwa/app/onboarding/OnboardingFlow.tsx,
 *  copy verbatim. The hifz terms are not glossed here (the web did not
 *  either); their plain-language meanings (CLAUDE.md) live in ENTRY_META in
 *  src/lib/entries.ts and show on the log sheet. */
const MODE_CARDS: {
  mode: Mode;
  icon: typeof BookMarked;
  title: string;
  sub: string;
  desc: string;
}[] = [
  {
    mode: "hifz",
    icon: BookMarked,
    title: "Memorizing",
    sub: "Hifz",
    desc: "Track sabak, sabak para, and dhor.",
  },
  {
    mode: "reading",
    icon: BookOpen,
    title: "Reading",
    sub: "Cover to cover",
    desc: "Log reading and revising.",
  },
];

/** Step 1 of onboarding: pick a study mode. The screen owns the state. */
export function ModeStep({
  mode,
  onChange,
}: {
  mode: Mode | null;
  onChange: (mode: Mode) => void;
}) {
  const c = useTheme();
  return (
    <>
      <Text style={[Type.title1, styles.title, { color: c.foreground }]}>
        What are you working on?
      </Text>
      <Text style={[Type.callout, styles.intro, { color: c.muted }]}>
        This sets your log options and default charts. You can change it later in
        Settings.
      </Text>

      <View style={styles.cards}>
        {MODE_CARDS.map((card) => {
          const selected = mode === card.mode;
          const Icon = card.icon;
          return (
            <Pressable
              key={card.mode}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(card.mode)}
              style={[
                styles.card,
                selected
                  ? [{ borderColor: c.accent, backgroundColor: c.accentTint }, Elevation.e1]
                  : { borderColor: c.border, backgroundColor: c.surface },
              ]}
            >
              <View
                style={[
                  styles.iconBox,
                  { backgroundColor: selected ? c.accent : c.surface2 },
                ]}
              >
                <Icon size={20} color={selected ? c.onAccent : c.muted} />
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardHead}>
                  <Text style={[Type.callout, styles.cardTitle, { color: c.foreground }]}>
                    {card.title}
                  </Text>
                  {selected && (
                    <View style={[styles.checkBadge, { backgroundColor: c.accent }]}>
                      <Check size={14} color={c.onAccent} strokeWidth={3} />
                    </View>
                  )}
                </View>
                <Text style={[Type.footnote, styles.cardSub, { color: c.faint }]}>
                  {card.sub}
                </Text>
                <Text style={[Type.footnote, styles.cardDesc, { color: c.muted }]}>
                  {card.desc}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 8 },
  intro: { marginTop: 8 },
  // web: mt-7 space-y-3
  cards: { marginTop: 28, gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: 16,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontWeight: "600" },
  cardSub: { fontWeight: "500" },
  cardDesc: { marginTop: 4 },
  checkBadge: {
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
});
