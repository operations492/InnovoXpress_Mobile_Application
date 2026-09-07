// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Generated: expo-router writes .expo/types on every start, and expo-doctor
    // regenerates expo-env.d.ts — linting either only ever reports on codegen.
    ignores: ["dist/*", ".expo/*", "expo-env.d.ts", "android/*", "ios/*"],
  },
  {
    /*
     * Build tooling, not app source. These run under Node during `postinstall`
     * and are never bundled by Metro, so the Expo preset's React Native globals
     * are the wrong environment — it reports `__dirname` and `Buffer` as
     * undefined. Declaring the environment lints them properly rather than
     * silencing them.
     */
    files: ["scripts/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        __dirname: "readonly",
        Buffer: "readonly",
        console: "readonly",
        module: "writable",
        process: "readonly",
        require: "readonly",
      },
    },
  },
]);
