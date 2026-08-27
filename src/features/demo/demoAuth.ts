import type { Session } from '@supabase/supabase-js';

/**
 * A stand-in for `supabase.auth`, for demo mode.
 *
 * It implements exactly the surface `AuthProvider` and the API client use, and
 * behaves the same way — including emitting through `onAuthStateChange`, so the
 * provider needs no demo branch of its own. Any email and password are accepted,
 * because there is nothing to authenticate against.
 */

const DEMO_SESSION = {
  access_token: 'demo-access-token',
  refresh_token: 'demo-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: 'demo-user',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'driver@innovoxpress.com',
    app_metadata: { role: 'driver' },
    user_metadata: { name: 'Imran Abdullah' },
    created_at: new Date().toISOString(),
  },
} as unknown as Session;

type Listener = (event: string, session: Session | null) => void;

let session: Session | null = null;
const listeners = new Set<Listener>();

function emit(event: string) {
  listeners.forEach((fn) => fn(event, session));
}

export const demoAuth = {
  async getSession() {
    return { data: { session }, error: null };
  },

  onAuthStateChange(callback: Listener) {
    listeners.add(callback);
    return {
      data: { subscription: { unsubscribe: () => listeners.delete(callback) } },
    };
  },

  async signInWithPassword({ email }: { email: string; password: string }) {
    session = {
      ...DEMO_SESSION,
      user: { ...DEMO_SESSION.user, email: email || DEMO_SESSION.user.email },
    } as Session;
    emit('SIGNED_IN');
    return { data: { session, user: session.user }, error: null };
  },

  async signOut() {
    session = null;
    emit('SIGNED_OUT');
    return { error: null };
  },

  async refreshSession() {
    return { data: { session, user: session?.user ?? null }, error: null };
  },

  // No timers to run when there is nothing to refresh.
  startAutoRefresh() {},
  stopAutoRefresh() {},
};
