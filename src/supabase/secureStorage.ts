import * as SecureStore from "expo-secure-store";

/**
 * supabase-js storage adapter backed by the device Keychain / Keystore.
 *
 * Why chunked: a Supabase session (access JWT + refresh token + user record)
 * is routinely 2 to 4 KB, and iOS keychain writes above ~2048 bytes have
 * failed on some releases (Expo used to warn at that size). Splitting the
 * value across several keychain items keeps the whole session in secure
 * storage without an extra encryption layer or AsyncStorage dependency.
 *
 * Layout per logical key K:
 *   K           -> "chunks:<n>" (manifest) or, for small values, the value
 *   K.0 .. K.n-1 -> the chunks
 * Chunks are cut on UTF-16 code units but never inside a surrogate pair: the
 * JS-to-native bridge is UTF-8 and cannot carry a lone surrogate, so a cut
 * through an emoji in user metadata would corrupt the stored JSON.
 *
 * All three operations run through one promise-chain mutex. supabase-js is
 * lockless on React Native and re-reads storage on every getSession(), so a
 * token-refresh write overlapping a data query's read could otherwise see
 * the old manifest with a mix of old and new chunks.
 */
const CHUNK = 1500;
const MANIFEST = "chunks:";

const OPTIONS: SecureStore.SecureStoreOptions = {
  // The session must be readable while a background refresh runs after the
  // device was unlocked once (push-triggered launches, background fetch).
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

function chunkKey(key: string, i: number): string {
  return `${key}.${i}`;
}

async function removeChunks(key: string, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS),
    ),
  );
}

/** Split without cutting between a high and a low surrogate. */
function chunksOf(value: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < value.length) {
    let cut = Math.min(i + CHUNK, value.length);
    const code = value.charCodeAt(cut - 1);
    if (cut < value.length && code >= 0xd800 && code <= 0xdbff) cut -= 1;
    out.push(value.slice(i, cut));
    i = cut;
  }
  return out;
}

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

async function readManifestCount(key: string): Promise<number> {
  const head = await SecureStore.getItemAsync(key, OPTIONS);
  if (head && head.startsWith(MANIFEST)) {
    const n = Number(head.slice(MANIFEST.length));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export const secureStorage = {
  getItem(key: string): Promise<string | null> {
    return serialized(async () => {
      const head = await SecureStore.getItemAsync(key, OPTIONS);
      if (head == null) return null;
      if (!head.startsWith(MANIFEST)) return head;
      const n = Number(head.slice(MANIFEST.length));
      if (!Number.isFinite(n) || n <= 0) return null;
      const parts = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          SecureStore.getItemAsync(chunkKey(key, i), OPTIONS),
        ),
      );
      // A missing chunk means a torn write; treat the session as absent rather
      // than hand supabase-js a truncated JSON string.
      if (parts.some((p) => p == null)) return null;
      return parts.join("");
    });
  },

  setItem(key: string, value: string): Promise<void> {
    return serialized(async () => {
      const previous = await readManifestCount(key);
      if (value.length <= CHUNK) {
        await SecureStore.setItemAsync(key, value, OPTIONS);
        if (previous > 0) await removeChunks(key, previous);
        return;
      }
      const chunks = chunksOf(value);
      const n = chunks.length;
      // Write chunks first, then the manifest, so a reader never sees a
      // manifest pointing at chunks that are not there yet.
      await Promise.all(
        chunks.map((chunk, i) => SecureStore.setItemAsync(chunkKey(key, i), chunk, OPTIONS)),
      );
      await SecureStore.setItemAsync(key, `${MANIFEST}${n}`, OPTIONS);
      if (previous > n) {
        await Promise.all(
          Array.from({ length: previous - n }, (_, i) =>
            SecureStore.deleteItemAsync(chunkKey(key, n + i), OPTIONS),
          ),
        );
      }
    });
  },

  removeItem(key: string): Promise<void> {
    return serialized(async () => {
      const n = await readManifestCount(key);
      await SecureStore.deleteItemAsync(key, OPTIONS);
      if (n > 0) await removeChunks(key, n);
    });
  },
};
