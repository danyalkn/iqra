import { Image, type ImageSource } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Keyboard, Modal, Pressable, StyleSheet, View } from "react-native";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { useWindowInsets } from "@/hooks/use-window-insets";

/**
 * A picture from the chat, full screen on black: tap anywhere or the X to
 * close. No pinch zoom yet; the stored copy is 1600 px on its long edge, so
 * "contain" on a phone already shows all of it. A transparent Modal, like
 * ActionOverlay, so it sits above the tab bar; it drops the keyboard on open
 * (iOS draws the keyboard over any Modal), and runs under both system bars
 * so the black reaches every edge on Android too. The status bar turns
 * light over the black while it is open; Android's Modal copies the app
 * window's bar look when it shows, so the style is set first and the Modal
 * shows a frame later.
 */
export function ImageViewer({
  source,
  onClose,
}: {
  source: ImageSource | null;
  onClose: () => void;
}) {
  const insets = useWindowInsets();
  const scheme = useColorScheme();
  const open = !!source;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) return;
    Keyboard.dismiss();
    StatusBar.setStyle("light", true);
    const frame = requestAnimationFrame(() => setShown(true));
    return () => {
      cancelAnimationFrame(frame);
      setShown(false);
      // Back to the app's own look (the root layout's StatusBar).
      StatusBar.setStyle(scheme === "dark" ? "light" : "dark", true);
    };
  }, [open, scheme]);
  return (
    <Modal
      visible={open && shown}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.root} onPress={onClose}>
        {source && (
          <Image source={source} style={styles.image} contentFit="contain" transition={120} accessibilityLabel="Photo" />
        )}
        <View style={[styles.close, { top: insets.top + 8 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <X size={20} color="#ffffff" />
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000", alignItems: "stretch", justifyContent: "center" },
  image: { flex: 1 },
  close: { position: "absolute", right: 16 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
});
