/**
 * Push payloads and the web PWA use web-style in-app paths:
 *   /today?log=<type>&r=<reminder id>   (one-time reminder)
 *   /chat                               (chat message, mention, nudge)
 *   /stats#recap                        (Sunday recap)
 * Expo Router has no hash fragments, so `#recap` becomes `?section=recap`.
 * Everything else passes through. Pure, so the web repo could share it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID (reminder ids in deep links are untrusted). */
export function isUuid(value: string | null | undefined): boolean {
  return !!value && UUID.test(value);
}

/** Map a push/web `url` path to the href Expo Router expects. Returns null
 *  for anything that is not an in-app path (absolute URLs, empty). */
export function toNativeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  let path = url.trim();
  // Accept the custom scheme too (iqra://today -> /today).
  const scheme = /^iqra:\/\/+/i;
  if (scheme.test(path)) path = "/" + path.replace(scheme, "");
  if (!path.startsWith("/")) return null;

  const hashAt = path.indexOf("#");
  if (hashAt === -1) return path;
  const base = path.slice(0, hashAt);
  const hash = path.slice(hashAt + 1);
  if (!hash) return base;
  return `${base}${base.includes("?") ? "&" : "?"}section=${encodeURIComponent(hash)}`;
}
