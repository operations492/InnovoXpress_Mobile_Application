import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Slot, SplashScreen, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Unbounded_600SemiBold, Unbounded_700Bold } from '@expo-google-fonts/unbounded';
import {
  SometypeMono_400Regular,
  SometypeMono_500Medium,
  SometypeMono_600SemiBold,
} from '@expo-google-fonts/sometype-mono';

import { ApiError, SessionExpiredError } from '@/api/client';
import { DemoBanner } from '@/components/DemoBanner';
import { DialogHost } from '@/components/Dialog';
import { LocationGate } from '@/components/LocationGate';
import { PushNotifications } from '@/features/notifications/PushNotifications';
import { env } from '@/lib/env';
import { startQueryFocusTracking } from '@/lib/queryFocus';
import { AuthProvider, useAuth } from '@/state/AuthProvider';
import { ShiftProvider } from '@/state/ShiftProvider';
import { color } from '@/theme/tokens';
// Imported for its side effect: the background location task must be defined at
// module scope, before the OS can wake the app to deliver a fix.
import '@/features/location/tracking';

void SplashScreen.preventAutoHideAsync();

/**
 * A driver is on a phone in a van. Retrying a failed read is almost always the
 * right call, and refetching when they come back to the app is what makes the
 * list correct after ten minutes in a basement.
 */
function makeQueryClient(onSessionExpired: () => void) {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof SessionExpiredError) onSessionExpired();
      },
    }),
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          // A 4xx will not become a 2xx by asking again — except 401, which the
          // client already handled by refreshing once before it got here.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        staleTime: 15_000,
      },
      mutations: { retry: false },
    },
  });
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    Unbounded_600SemiBold,
    Unbounded_700Bold,
    SometypeMono_400Regular,
    SometypeMono_500Medium,
    SometypeMono_600SemiBold,
  });

  const [queryClient] = useState(() =>
    makeQueryClient(() => {
      // The API client already tried one refresh. Reaching here means the
      // refresh token is dead, so there is nothing to do but sign out — and
      // `AuthProvider` will render the login screen the moment it notices.
      void import('@/lib/supabase').then(({ supabase }) => supabase.auth.signOut());
    }),
  );

  // A missing font must not mean a blank app; RN falls back to the system face.
  const ready = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // Stops every poll in the app while it is backgrounded — see the note in
  // `queryFocus`. Mounted once, at the root, because focus is global.
  useEffect(startQueryFocusTracking, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            {/*
              The gate sits ABOVE ShiftProvider deliberately. ShiftProvider starts
              the location service as soon as a session exists, and its effect
              depends on the session — not on the permission. Mounted the other way
              round it would fire once before the driver had granted anything, fail,
              and never retry, leaving a signed-in driver silently untracked.

              Above it, the provider does not exist until location is usable, so
              its first run is also its correct one.
            */}
            <LocationGuard>
              <ShiftProvider>
                <StatusBar style="dark" />
                <PushNotifications />
                <AuthGate />
              </ShiftProvider>
            </LocationGuard>
          </AuthProvider>
        </QueryClientProvider>

        {/*
          Outside QueryClientProvider and outside the location gate on purpose.
          The host needs neither, and both of those can render *instead of* their
          children — a dialog raised while the gate is up (or before a session
          exists) would otherwise have nowhere to appear. Inside SafeAreaProvider
          because it reads the real insets, not the zeroed ones the demo banner
          hands down.
        */}
        <DialogHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The login screen is a redirect target, not a wrapper.
 *
 * Rendering it *instead of* the tree would unmount every screen on a token
 * blip; redirecting keeps navigation state intact and puts the driver back where
 * they were once they sign in again.
 */
function AuthGate() {
  const { session, initialising } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initialising) return;

    const onSignIn = segments[0] === 'sign-in';

    if (!session && !onSignIn) router.replace('/sign-in');
    else if (session && onSignIn) router.replace('/');
  }, [session, initialising, segments, router]);

  if (initialising) return <View style={styles.splash} />;

  return <Shell />;
}

/**
 * Location is demanded only once there is somebody to demand it of.
 *
 * Blocking the login screen too would be a dead end: a driver cannot grant a
 * permission for an account they have not yet proved they own, and the prompt
 * makes no sense before the app has said who it is. Demo mode is exempt — there
 * is no dispatch to report to, so the permission would buy nothing.
 */
function LocationGuard({ children }: { children: ReactNode }) {
  const { session } = useAuth();

  return (
    <LocationGate enabled={Boolean(session) && !env.demo}>{children}</LocationGate>
  );
}

/**
 * In demo mode the banner takes the status-bar inset for itself, then hands
 * children a top inset of 0.
 *
 * Without that override every screen would pad for a status bar that the banner
 * is already sitting under, and the whole app would gain a dead strip.
 */
function Shell() {
  const insets = useSafeAreaInsets();

  if (!env.demo) return <Slot />;

  return (
    <View style={styles.root}>
      <View style={{ paddingTop: insets.top, backgroundColor: color.warnSoft }}>
        <DemoBanner />
      </View>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <Slot />
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bgCanvas },
  splash: { flex: 1, backgroundColor: color.bgCanvas },
});
