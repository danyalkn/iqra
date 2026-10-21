import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { uuidv4 } from "@/lib/uuid";
import { supabase } from "@/supabase/client";

/**
 * Pictures in the circle chat (owner, 2026-10-21): one JPEG per message,
 * made small on the phone before it leaves, kept in Supabase Storage (the
 * `chat-images` bucket, private, read and written under the group's folder
 * by its members only; migration 20261021200000). Nothing here touches the
 * web app on Fly, and no Firebase: the bucket sits behind the same login
 * and row rules as everything else.
 *
 * Size: the long edge is capped at 1600 px and the JPEG saved at quality
 * 0.8, which is sharp on a phone (a 3x screen is about 1200 px wide) and
 * lands around 200 to 400 KB instead of the 3 to 8 MB a camera writes.
 * Re-encoding also drops EXIF, so no location leaves the phone. The free
 * Supabase plan allows 1 GB stored and 5 GB a month out; at that size the
 * circle can send a few thousand pictures before either matters.
 */
export const CHAT_IMAGES_BUCKET = "chat-images";
/** Longest side after resizing, in pixels. */
const MAX_EDGE = 1600;
/** JPEG quality; a second pass at the lower one if the first is still big. */
const QUALITY = 0.8;
const QUALITY_RETRY = 0.6;
/** The bucket refuses anything over 2 MB; stay under with margin. */
const MAX_BYTES = 1_900_000;

export type PickedImage = {
  /** Local file of the compressed copy (the cache directory). */
  uri: string;
  width: number;
  height: number;
  bytes: number;
};

/** The photo library (no permission prompt on iOS 14+ or Android 13+,
 *  the system picker hands over only what was chosen). Null when
 *  cancelled. Returns the resized, re-encoded copy. */
export async function pickChatImage(): Promise<PickedImage | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 1,
    exif: false,
  });
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  return compressForChat(asset.uri);
}

/** Resize to the long-edge cap and save as JPEG; the picker's reported
 *  dimensions can be 0, so the loaded image's own are used. */
export async function compressForChat(uri: string): Promise<PickedImage> {
  const loaded = await ImageManipulator.manipulate(uri).renderAsync();
  const { width, height } = loaded;
  const ctx = ImageManipulator.manipulate(loaded);
  if (Math.max(width, height) > MAX_EDGE) {
    ctx.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const ref = await ctx.renderAsync();
  let out = await ref.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
  let size = new File(out.uri).size;
  if (size > MAX_BYTES) {
    // A detailed picture at the cap can still run large: trade a little
    // quality for the bucket's limit rather than fail the send.
    const first = new File(out.uri);
    out = await ref.saveAsync({ compress: QUALITY_RETRY, format: SaveFormat.JPEG });
    size = new File(out.uri).size;
    try {
      first.delete();
    } catch {
      // The cache directory is the system's to clean anyway.
    }
  }
  return { uri: out.uri, width: out.width, height: out.height, bytes: size };
}

/** Upload under the group's folder with a fresh name; returns the object
 *  path to store on the message. Throws on failure (the caller shows the
 *  chat's usual send error). */
export async function uploadChatImage(groupId: string, image: PickedImage): Promise<string> {
  const path = `${groupId}/${uuidv4()}.jpg`;
  const bytes = await new File(image.uri).bytes();
  const { error } = await supabase.storage.from(CHAT_IMAGES_BUCKET).upload(path, bytes, {
    contentType: "image/jpeg",
    upsert: false,
    // The object never changes, so phones and the CDN may keep it for a year.
    cacheControl: "31536000",
  });
  if (error) throw error;
  return path;
}

/** Best effort: an object whose message never landed, or whose message
 *  was deleted by its sender. */
export async function deleteChatImage(path: string): Promise<void> {
  await supabase.storage.from(CHAT_IMAGES_BUCKET).remove([path]).catch(() => {});
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * An expo-image source for a stored picture: the authenticated object URL
 * with the member's token, and the object path as the cache key, so each
 * phone downloads a picture once and shows it from disk after that, token
 * rotations included (the token is only read when there is no cached
 * copy). A private bucket needs no signed URLs this way.
 */
export function chatImageSource(path: string, accessToken: string | null) {
  return {
    uri: `${SUPABASE_URL}/storage/v1/object/authenticated/${CHAT_IMAGES_BUCKET}/${path}`,
    headers: { Authorization: `Bearer ${accessToken ?? ""}`, apikey: SUPABASE_KEY },
    cacheKey: path,
  };
}
