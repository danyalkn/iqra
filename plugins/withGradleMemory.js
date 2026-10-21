// Gradle JVM memory for the Android build (EAS and local). The template's
// gradle.properties gives Gradle a 2 GB heap and 512 MB of Metaspace; with
// the picture modules (expo-image-picker, expo-image-manipulator) on top of
// keyboard-controller, reanimated and the rest, the Kotlin compile crossed
// that on EAS's worker and the daemon was killed ("Gradle build daemon
// disappeared unexpectedly", build 08ca7d61, 2026-10-21). The same values
// fixed the local build on 2026-10-20 (docs/ANDROID.md).
/* eslint-disable @typescript-eslint/no-require-imports */
const { withGradleProperties } = require("expo/config-plugins");

const KEY = "org.gradle.jvmargs";
const VALUE = "-Xmx4096m -XX:MaxMetaspaceSize=1536m";

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter(
      (item) => !(item.type === "property" && item.key === KEY),
    );
    config.modResults.push({ type: "property", key: KEY, value: VALUE });
    return config;
  });
};
