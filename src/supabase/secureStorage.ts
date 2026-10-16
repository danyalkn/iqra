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
 * Chunk boundaries are by UTF-16 code unit; the keychain stores strings, so a
 * split inside a surrogate pair round-trips fine as long as we join in order.
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

async function readManifestCount(key: string): Promise<number> {
  const head = await SecureStore.getItemAsync(key, OPTIONS);
  if (head && head.startsWith(MANIFEST)) {
    const n = Number(head.slice(MANIFEST.length));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
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
  },

  async setItem(key: string, value: string): Promise<void> {
    const previous = await readManifestCount(key);
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value, OPTIONS);
      if (previous > 0) await removeChunks(key, previous);
      return;
    }
    const n = Math.ceil(value.length / CHUNK);
    // Write chunks first, then the manifest, so a reader never sees a
    // manifest pointing at chunks that are not there yet.
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        SecureStore.setItemAsync(
          chunkKey(key, i),
          value.slice(i * CHUNK, (i + 1) * CHUNK),
          OPTIONS,
        ),
      ),
    );
    await SecureStore.setItemAsync(key, `${MANIFEST}${n}`, OPTIONS);
    if (previous > n) {
      await Promise.all(
        Array.from({ length: previous - n }, (_, i) =>
          SecureStore.deleteItemAsync(chunkKey(key, n + i), OPTIONS),
        ),
      );
    }
  },

  async removeItem(key: string): Promise<void> {
    const n = await readManifestCount(key);
    await SecureStore.deleteItemAsync(key, OPTIONS);
    if (n > 0) await removeChunks(key, n);
  },
};
