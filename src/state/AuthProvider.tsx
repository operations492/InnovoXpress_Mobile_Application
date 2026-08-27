import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, startSessionAutoRefresh } from '@/lib/supabase';
import { setShift } from '@/api/endpoints';
import * as buffer from '@/features/location/buffer';
import * as tracking from '@/features/location/tracking';

/**
 * Sign-in lives entirely in Supabase — the API has no login endpoint by design.
 * This provider owns the session and nothing else; "am I allowed to do X" is the
 * server's answer, never this file's.
 */

interface AuthValue {
  session: Session | null;
  /** True until the stored session has been read; renders the splash, not the login screen. */
  initialising: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Supabase reports failed sign-ins in a way that is accurate and unhelpful on a
 * phone. These are the two a driver actually hits.
 */
function readableAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'That email and password do not match an Innovo Xpress account.';
  }
  if (m.includes('email not confirmed')) {
    return 'This account has not been confirmed yet. Ask dispatch to finish setting it up.';
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'Cannot reach the sign-in service. Check your connection and try again.';
  }
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialising, setInitialising] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .finally(() => {
        if (active) setInitialising(false);
      });

    // Fires for sign-in, sign-out AND every silent token refresh, which is what
    // keeps a long shift from ending in a screen of 401s.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    const stopRefresh = startSessionAutoRefresh();

    return () => {
      active = false;
      sub.subscription.unsubscribe();
      stopRefresh();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw new Error(readableAuthError(error.message));
  }, []);

  const signOut = useCallback(async () => {
    // Order matters. Stop reporting position first — a signed-out app that is
    // still pushing GPS is the one bug in here nobody would forgive.
    await tracking.stop().catch(() => undefined);

    /*
     * Then close the shift, while the token is still valid.
     *
     * Signing in opens the shift, so signing out has to close it. Skip this and
     * the driver stays clocked on with nothing reporting — dispatch sees them
     * listed but frozen, which is precisely the ambiguity this design removes.
     *
     * Best-effort on purpose: a driver signing out in a basement should not be
     * trapped in the app, and the 04:00 job closes an abandoned shift anyway.
     */
    await setShift(false).catch(() => undefined);

    await buffer.clear().catch(() => undefined);
    await buffer.setActiveConsignment(null).catch(() => undefined);
    await supabase.auth.signOut();
    // Cached jobs belong to the driver who just left the device.
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthValue>(
    () => ({ session, initialising, signIn, signOut }),
    [session, initialising, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
