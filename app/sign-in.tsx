import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Body, Display, Small, Tiny } from '@/components/Text';
import { useAuth } from '@/state/AuthProvider';
import { env } from '@/lib/env';
import { color, font, radius, shadow } from '@/theme/tokens';

/**
 * Sign-in goes straight to Supabase — the API has no login endpoint, on purpose:
 * proxying it would add a hop, lose automatic token refresh, and leave two
 * places that have to agree about what a valid session is.
 *
 * Accounts are created by an admin in the console. There is deliberately no
 * self-registration and no password reset here; a driver who is locked out calls
 * dispatch, which is also the check that stops an unknown phone signing in.
 */
export default function SignInScreen() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();

  // Demo mode accepts anything, so it arrives filled in — one tap to the app.
  const [email, setEmail] = useState(env.demo ? 'driver@innovoxpress.com' : '');
  const [password, setPassword] = useState(env.demo ? 'demo' : '');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const submit = useCallback(async () => {
    if (busy) return;
    if (!email.trim() || !password) {
      setError('Enter the email and password dispatch gave you.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      // No navigation here — AuthGate redirects as soon as the session lands, so
      // pushing as well would race it and double-render the tab bar.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }, [busy, email, password, signIn]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 28 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.mark}>
          <Icon name="truck" size={30} color={color.onPrimary} />
        </View>

        <Display style={styles.heading}>Innovo Xpress</Display>
        <Small style={styles.sub}>Driver app — sign in to see your run.</Small>

        <View style={styles.form}>
          <Field label="Email">
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@innovoxpress.com"
              placeholderTextColor={color.faint}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              style={styles.input}
              editable={!busy}
            />
          </Field>

          <Field label="Password">
            <View style={styles.passwordRow}>
              <TextInput
                ref={passwordRef}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={color.faint}
                secureTextEntry={!reveal}
                autoCapitalize="none"
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                style={[styles.input, styles.passwordInput]}
                editable={!busy}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
                onPress={() => setReveal((v) => !v)}
                hitSlop={8}
                style={styles.reveal}
              >
                <Icon name={reveal ? 'eye-off' : 'eye'} size={18} color={color.muted} />
              </Pressable>
            </View>
          </Field>

          {error ? (
            <View style={styles.error}>
              <Icon name="alert-circle" size={16} color={color.dangerText} />
              <Body style={styles.errorText}>{error}</Body>
            </View>
          ) : null}

          <PrimaryButton
            label={busy ? 'Signing in…' : 'Sign in'}
            onPress={() => void submit()}
            loading={busy}
            icon="log-in"
          />
        </View>

        <View style={styles.footer}>
          {busy ? <ActivityIndicator color={color.muted} /> : null}
          <Tiny style={styles.footerText}>
            {env.demo
              ? 'Demo mode — no server and no account needed. Any email and password will sign you in to sample data.'
              : "Accounts are issued by dispatch. If you cannot get in, call the office rather than sharing someone else's login — every job records who moved it."}
          </Tiny>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Tiny style={styles.fieldLabel}>{label}</Tiny>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgCanvas },
  content: { paddingHorizontal: 22, gap: 4, flexGrow: 1 },

  mark: {
    width: 62,
    height: 62,
    borderRadius: 20,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    ...shadow.glow,
  },
  heading: { fontSize: 26, letterSpacing: -0.6 },
  sub: { marginTop: 6, fontSize: 14 },

  form: {
    marginTop: 28,
    gap: 14,
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    padding: 18,
    ...shadow.card,
  },
  field: { gap: 7 },
  fieldLabel: { fontFamily: font.bold, fontSize: 11.5, color: color.primary },
  input: {
    fontFamily: font.regular,
    fontSize: 15.5,
    color: color.ink,
    backgroundColor: color.surfaceSoft,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  passwordRow: { justifyContent: 'center' },
  passwordInput: { paddingRight: 46 },
  reveal: { position: 'absolute', right: 12, padding: 4 },

  error: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: color.dangerSoft,
    borderWidth: 1,
    borderColor: color.dangerBorder,
    borderRadius: radius.md,
    padding: 11,
  },
  errorText: { flex: 1, color: color.dangerText, fontSize: 13, lineHeight: 18 },

  footer: { marginTop: 'auto', paddingTop: 28, gap: 10, alignItems: 'center' },
  footerText: { textAlign: 'center', lineHeight: 17, color: color.muted },
});
