// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Generated: expo-router writes .expo/types on every start, and expo-doctor
    // regenerates expo-env.d.ts — linting either only ever reports on codegen.
    ignores: ["dist/*", ".expo/*", "expo-env.d.ts", "android/*", "ios/*"],
  }
]);
