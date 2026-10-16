import type { ReactNode } from "react";
import { StyleSheet, Text } from "react-native";

import { useTheme } from "@/hooks/use-theme";

import type { MessageBodyProps } from "./contracts";
import { mentionRegex } from "./shared";

/** Nested Text cannot pad on Android, so a thin space on each side of a
 *  tinted mention stands in for the web's `px-0.5`. Underlined (mine)
 *  mentions get none: a thin space under an underline reads as a stray
 *  dash. */
const PAD = "\u2009";

/**
 * A message body with @mentions of known members (and @all) highlighted.
 * Ported from MessageBody at the top of
 * reference/web-pwa/app/(app)/chat/ChatClient.tsx: the regex comes from
 * shared.ts (member names before @all, so a name starting with "All" wins),
 * and the walk alternates plain slices with highlighted spans. The web
 * rendered a fragment inside the bubble's <p>; native renders one <Text>
 * with the bubble's style so nested spans inherit size and colour.
 */
export function MessageBody({ body, names, mine, style }: MessageBodyProps) {
  const c = useTheme();
  const re = mentionRegex(names);
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  // Every match consumes at least the "@", so the global exec loop advances.
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(
      mine ? (
        <Text key={i++} style={styles.mine}>
          {m[0]}
        </Text>
      ) : (
        <Text key={i++} style={[styles.other, { backgroundColor: c.accentTint, color: c.accent }]}>
          {PAD}
          {m[0]}
          {PAD}
        </Text>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return <Text style={style}>{out}</Text>;
}

const styles = StyleSheet.create({
  // Mine sits on the accent bubble, so a tint would vanish: underline instead.
  mine: { fontWeight: "600", textDecorationLine: "underline" },
  other: { fontWeight: "600" },
});
