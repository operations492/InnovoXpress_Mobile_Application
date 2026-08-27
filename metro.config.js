// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

/**
 * Make the `@/components/maps` alias honour platform extensions.
 *
 * `src/components/maps.web.tsx` exists precisely so the browser bundle gets a
 * placeholder instead of `react-native-maps`, which ships no web build — its
 * entry calls `codegenNativeComponent`, which `react-native-web` does not
 * export, so merely importing it throws:
 *
 *   TypeError: (0, _reactNativeWebDistIndex.codegenNativeComponent) is not a function
 *
 * Metro normally picks `.web.tsx` automatically. It does NOT when the import
 * goes through a tsconfig `paths` alias: `@/components/maps` is mapped straight
 * to a concrete file, and the platform-extension pass never runs. Both screens
 * import via `@/`, so on web they got `maps.ts` — and with it the real
 * `react-native-maps`.
 *
 * Redirecting the specifier itself is the narrowest fix: native resolution is
 * untouched, and any future importer of the alias is covered too.
 */
const webOverrides = {
  '@/components/maps': path.resolve(__dirname, 'src/components/maps.web.tsx'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    const override = webOverrides[moduleName];
    if (override) return { type: 'sourceFile', filePath: override };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
