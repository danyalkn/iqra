/**
 * Random (version 4) UUIDs made on the device, so an entry logged offline
 * has its real primary key before the server ever sees it: a retry of the
 * same row then hits the key instead of writing a second entry
 * (docs/NEXT-SESSION.md "Offline logging").
 *
 * Uses crypto.getRandomValues where the runtime has it and falls back to
 * Math.random, which is plenty for a key that only has to be unique among
 * one small circle's entries (122 random bits either way). No crypto
 * package: expo-crypto is native and would need a new build.
 *
 * Pure: no React, no DOM, no react-native. Native-first file (not yet in the
 * web repo).
 */

type RandomSource = (bytes: Uint8Array) => void;

function systemRandom(): RandomSource {
  const c = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } })
    .crypto;
  if (c && typeof c.getRandomValues === "function") {
    const get = c.getRandomValues.bind(c);
    return (bytes) => {
      get(bytes);
    };
  }
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  };
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** A new v4 UUID, lowercase, in the 8-4-4-4-12 form Postgres prints. */
export function uuidv4(random: RandomSource = systemRandom()): string {
  const b = new Uint8Array(16);
  random(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = Array.from(b, (x) => HEX[x]);
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h
    .slice(8, 10)
    .join("")}-${h.slice(10).join("")}`;
}
