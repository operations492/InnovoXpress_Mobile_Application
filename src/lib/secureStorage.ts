import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Session storage for Supabase Auth.
 *
 * A Supabase session is an access token plus a refresh token, and the refresh
 * token is the part that matters: it can mint new access tokens for weeks. On a
 * courier's phone that is the credential to a live account, so it goes in the
 * Keychain / Keystore rather than in plain AsyncStorage.
 *
 * SecureStore warns above 2048 bytes and can fail outright on some Android
 * builds, and a session with custom claims comfortably exceeds that — hence the
 * chunking. The chunk COUNT is stored under the base key so a shrinking session
 * cannot leave orphaned tails behind that a later read would splice back in.
 */

const CHUNK = 1800;
const countKey = (key: string) => `${key}.__parts`;
const partKey = (key: string, i: number) => `${key}.__p${i}`;

/** SecureStore has no web implementation; the dev web target falls back. */
const usable = Platform.OS !== 'web';

async function clearParts(key: string, upTo: number) {
  for (let i = 0; i < upTo; i += 1) {
    await SecureStore.deleteItemAsync(partKey(key, i)).catch(() => undefined);
  }
}

async function partCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key)).catch(() => null);
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!usable) return AsyncStorage.getItem(key);
    try {
      const parts = await partCount(key);
      if (parts === 0) return await SecureStore.getItemAsync(key);

      const chunks: string[] = [];
      for (let i = 0; i < parts; i += 1) {
        const piece = await SecureStore.getItemAsync(partKey(key, i));
        // A missing chunk means a half-written session; treat it as no session
        // at all rather than handing Supabase a truncated, unparseable one.
        if (piece == null) return null;
        chunks.push(piece);
      }
      return chunks.join('');
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!usable) return AsyncStorage.setItem(key, value);

    const previous = await partCount(key);

    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value);
      await SecureStore.deleteItemAsync(countKey(key)).catch(() => undefined);
      await clearParts(key, previous);
      return;
    }

    const parts = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < parts; i += 1) {
      await SecureStore.setItemAsync(partKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    // Written last: until the count lands, a reader sees the previous session
    // rather than a half-written new one.
    await SecureStore.setItemAsync(countKey(key), String(parts));
    if (previous > parts) await clearParts(key, previous);
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
  },

  async removeItem(key: string): Promise<void> {
    if (!usable) return AsyncStorage.removeItem(key);
    const parts = await partCount(key);
    await clearParts(key, parts);
    await SecureStore.deleteItemAsync(countKey(key)).catch(() => undefined);
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
  },
};
