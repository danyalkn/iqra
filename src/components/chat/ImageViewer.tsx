import { Image, type ImageSource } from "expo-image";
import { X } from "lucide-react-native";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * A picture from the chat, full screen on black: tap anywhere or the X to
 * close. No pinch zoom yet; the stored copy is 1600 px on its long edge, so
 * "contain" on a phone already shows all of it. A transparent Modal, like
 * ActionOverlay, so it sits above the tab bar and the keyboard.
 */
export function ImageViewer({
  source,
  onClose,
}: {
  source: ImageSource | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={!!source}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
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
