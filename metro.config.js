// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

/**
 * Make the `@/components/maps` alias honour platform extensions.
 *
 * `src/components/maps.tsx` draws its map with Leaflet inside a
 * `react-native-webview`, which is a native component the browser has no use
 * for — on web the right answer is a real DOM map or nothing, not a WebView
 * wrapping a WebView. `maps.web.tsx` stands in with a placeholder.
 *
 * Metro normally picks `.web.tsx` automatically. It does NOT when the import
 * goes through a tsconfig `paths` alias: `@/components/maps` is mapped straight
 * to a concrete file, and the platform-extension pass never runs. Both screens
 * import via `@/`, so without this the browser bundle would get the native
 * implementation.
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
