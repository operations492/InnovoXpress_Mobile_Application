import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { env } from './env';
import { secureSessionStorage } from './secureStorage';
import { demoAuth } from '@/features/demo/demoAuth';

/**
 * The app signs in against Supabase directly — the API has no POST /login by
 * design. Supabase mints an ES256 token; the Express backend only verifies it
 * against the project JWKS. So this client is the whole of authentication.
 *
 * In demo mode there are no credentials to build a client from — `createClient`
 * would throw on an empty URL — so a stand-in with the same `auth` surface takes
 * its place and every caller stays unchanged.
 */
export const supabase = (
  env.demo
    ? { auth: demoAuth }
    : createClient(env.supabaseUrl, env.supabaseAnonKey, {
        auth: {
          storage: secureSessionStorage,
          autoRefreshToken: true,
          persistSession: true,
          // There is no URL to read a session out of on a phone, and leaving this
          // on makes the client poke at `window.location`, which does not exist.
          detectSessionInUrl: false,
        },
      })
) as SupabaseClient;

/**
 * Supabase's refresh timer is a `setInterval`, and the OS suspends those while
 * the app is backgrounded — a driver who leaves the app open in their pocket for
 * an hour would come back to an expired token and a screen of 401s. Stopping and
 * restarting the timer around foreground/background makes the client refresh
 * once on resume instead.
 */
let started = false;
export function startSessionAutoRefresh(): () => void {
  if (started) return () => undefined;
  started = true;

  if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();

  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });

  return () => {
    sub.remove();
    supabase.auth.stopAutoRefresh();
    started = false;
  };
}
