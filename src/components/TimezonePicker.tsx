import { Check } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Input, Sheet } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Common IANA zones for runtimes without `Intl.supportedValuesOf` (older
 * Hermes). Covers where the circle lives and travels; anything else can
 * still be typed in Settings later once the runtime grows the full list.
 */
const FALLBACK_ZONES = [
  "UTC",
  // Americas
  "America/Toronto",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Halifax",
  "America/Phoenix",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  // Europe
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Zurich",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Copenhagen",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  // Middle East and North Africa
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Qatar",
  "Asia/Kuwait",
  "Asia/Baghdad",
  "Asia/Tehran",
  "Asia/Jerusalem",
  "Asia/Amman",
  "Asia/Beirut",
  "Africa/Cairo",
  "Africa/Casablanca",
  // South Asia
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Colombo",
  "Asia/Kabul",
  // Asia
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Manila",
  "Asia/Tashkent",
  // Africa
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Africa/Addis_Ababa",
  // Oceania
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Pacific/Auckland",
];

/** The device's zone, the same call the web made in the browser. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** True when the runtime accepts this zone; `timezone` is stored verbatim
 *  on the profile and read by the reminder cron, so never store a bad one. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function allZones(): string[] {
  // Hermes grew supportedValuesOf late; guard it (see AGENTS.md on Intl).
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      const list = Intl.supportedValuesOf("timeZone");
      if (list.length > 0) return list;
    } catch {
      // fall through to the static list
    }
  }
  return FALLBACK_ZONES;
}

/** "America/Sao_Paulo" -> "America/Sao Paulo" (slashes stay, so the region
 *  grouping still reads). */
function displayName(tz: string): string {
  return tz.replace(/_/g, " ");
}

/**
 * "GMT-4", "GMT+5:30" or "GMT" for the zone at `now`, from its wall clock.
 * Intl's timeZoneName "shortOffset" said plain "GMT" for every zone on iOS
 * (Hermes there), so the offset is worked out instead: the zone's local
 * date and time read as if UTC, minus the instant (src/lib/dates does the
 * same for zonedIso). Null if Intl cannot render the zone.
 */
function offsetLabel(tz: string, now: Date): string | null {
  try {
    const p: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now)) {
      p[part.type] = part.value;
    }
    // Some engines render midnight as 24.
    const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    // The wall clock has no seconds, so compare it with the instant's minute.
    const minutes = Math.round((asIfUtc - Math.floor(now.getTime() / 60_000) * 60_000) / 60_000);
    if (!Number.isFinite(minutes)) return null;
    if (minutes === 0) return "GMT";
    const abs = Math.abs(minutes);
    const mm = abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : "";
    return `GMT${minutes < 0 ? "-" : "+"}${Math.floor(abs / 60)}${mm}`;
  } catch {
    return null;
  }
}

/** "GMT-4 · 3:45 PM" for the zone right now; null when Intl cannot do it. */
function zoneDetail(tz: string, now: Date): string | null {
  let time: string;
  try {
    time = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    }).format(now);
  } catch {
    return null;
  }
  const offset = offsetLabel(tz, now);
  return offset ? `${offset} · ${time}` : time;
}

type Props = {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (tz: string) => void;
};

/**
 * Searchable IANA time-zone sheet. The web had no picker (the browser's zone
 * was stored silently at onboarding); native adds one because members travel
 * and reminders, streaks and the 3 AM backdating window all run in
 * `profiles.timezone` (docs/HANDOFF.md § Working notes). The detected zone
 * is pinned first so "undo" is one tap.
 */
export function TimezonePicker({ open, onClose, value, onChange }: Props) {
  const c = useTheme();
  const { height: windowH } = useWindowDimensions();
  const [query, setQuery] = useState("");

  const detected = useMemo(() => detectTimezone(), []);
  // Snapshot the clock each time the sheet opens; rows show "local time
  // there" and a per-row Date would drift mid-scroll. Adjusted during render
  // on the prop flip (same pattern as Sheet) rather than in an effect.
  const [now, setNow] = useState(() => new Date());
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setNow(new Date());
  }

  const zones = useMemo(() => {
    const source = allZones();
    // Detected first, then the rest alphabetically. The detected zone and
    // the stored value may be missing from a static fallback list (or be a
    // legacy alias the runtime no longer enumerates); keep them selectable.
    const rest = new Set(source);
    rest.delete(detected);
    if (value && value !== detected) rest.add(value);
    return [detected, ...[...rest].sort((a, b) => a.localeCompare(b))];
  }, [detected, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/_/g, " ");
    if (!q) return zones;
    return zones.filter((tz) => displayName(tz).toLowerCase().includes(q));
  }, [zones, query]);

  const close = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  const choose = useCallback(
    (tz: string) => {
      if (!isValidTimezone(tz)) return;
      onChange(tz);
      close();
    },
    [onChange, close],
  );

  return (
    <Sheet open={open} onClose={close} dragAnywhere={false}>
      {/* The Sheet stays above the keyboard; flexShrink on the wrapper
          and the list lets the Sheet's cap take height from the list, so its
          scroll end stays reachable instead of being clipped. */}
      <View style={styles.shrink}>
        <View style={styles.header}>
          <Text style={[Type.title2, { color: c.foreground }]}>Time zone</Text>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search, e.g. Toronto or Karachi"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search time zones"
          />
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(tz) => tz}
          // A fixed (shrinkable) height keeps the panel the same size however
          // many zones match, so a narrow search does not collapse the sheet
          // into a short panel that sits behind the keyboard.
          style={[styles.shrink, { height: windowH * 0.6 }]}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={16}
          ListEmptyComponent={
            <Text style={[Type.footnote, styles.empty, { color: c.faint }]}>
              No zone matches that search.
            </Text>
          }
          renderItem={({ item: tz }) => {
            const selected = tz === value;
            const detail = zoneDetail(tz, now);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => choose(tz)}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: c.border },
                  pressed && { backgroundColor: c.surface2 },
                ]}
              >
                <View style={styles.rowText}>
                  <Text style={[Type.callout, { color: c.foreground }]} numberOfLines={1}>
                    {displayName(tz)}
                  </Text>
                  {detail && (
                    <Text style={[Type.footnote, { color: c.muted }]} numberOfLines={1}>
                      {detail}
                    </Text>
                  )}
                </View>
                {tz === detected && (
                  <Text style={[Type.caption, { color: c.accent }]}>Use detected</Text>
                )}
                {selected && <Check size={18} color={c.accent} strokeWidth={2.5} />}
              </Pressable>
            );
          }}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 12 },
  list: { paddingHorizontal: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, minWidth: 0 },
  empty: { textAlign: "center", paddingVertical: 24 },
});
