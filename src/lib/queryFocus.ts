import { AppState, type AppStateStatus } from 'react-native';
import { focusManager } from '@tanstack/react-query';

/**
 * Teach TanStack Query what "focused" means on a phone.
 *
 * Its default notion of focus is the browser's `window.focus`, which does not
 * exist here — so without this every `refetchInterval` in the app keeps firing
 * while the driver is in Maps, on a call, or has the screen off. On a device
 * that is already reporting GPS every fifteen seconds, that is three extra
 * background polls competing for the same radio and battery, for data nobody is
 * looking at.
 *
 * It also makes `refetchOnWindowFocus` mean something: coming back to the app
 * refreshes the screen the driver is actually looking at, which is the moment
 * stale data matters most.
 *
 * Returns its own unsubscribe so the caller owns the lifetime.
 */
export function startQueryFocusTracking(): () => void {
  const onChange = (status: AppStateStatus) => {
    // `inactive` is the iOS half-state — mid app-switcher, or a call banner
    // coming down. Treating it as blurred would cancel polls for a transition
    // the driver may abandon a second later.
    focusManager.setFocused(status === 'active');
  };

  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
}
