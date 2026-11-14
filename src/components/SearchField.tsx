import { useRef } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { color, font, radius } from '@/theme/tokens';
import { Icon } from './Icon';

/**
 * The run's search box, sized to live in the top bar.
 *
 * A plain always-visible field rather than an icon that expands into one. The
 * expanding pattern saves width that this bar does not need — its left half was
 * empty — and costs a tap before the driver can type, on a screen they are
 * holding in one hand beside a customer.
 *
 * Height is FIXED rather than derived from the font, so the bar cannot change
 * height when the field gains or loses its clear button. A bar that resizes
 * pushes the whole list down and back, which is the jiggle this screen was
 * reported for.
 */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  accessibilityLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
}) {
  const input = useRef<TextInput>(null);

  return (
    <View style={styles.wrap}>
      <Icon name="search" size={15} color={color.muted} />

      <TextInput
        ref={input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.faint}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        style={styles.input}
        /*
         * Order numbers and addresses, not prose. Autocorrect would "fix"
         * `IX-1182` and capitalisation would fight a lowercase search, so both
         * are off — and `search` on the return key dismisses the keyboard
         * instead of inserting a newline.
         */
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        returnKeyType="search"
        onSubmitEditing={() => Keyboard.dismiss()}
        /*
         * iOS draws its own clear button inside the field; Android draws
         * nothing, so the Pressable below covers it. Declaring the native one
         * on iOS AND rendering ours would show two.
         */
        clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : 'never'}
        // Never — the list behind this field IS the result, so there is nothing
        // to submit and no reason to steal focus on mount.
        autoFocus={false}
      />

      {/*
        Android's clear button. Hit slop rather than padding: the target needs
        to be thumb-sized without the icon growing or shifting the row.
      */}
      {Platform.OS !== 'ios' && value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => {
            onChange('');
            // Keep the keyboard up: clearing is almost always the start of a
            // different search, not the end of searching.
            input.current?.focus();
          }}
          hitSlop={10}
          style={({ pressed }) => (pressed ? styles.clearPressed : null)}
        >
          <Icon name="x" size={15} color={color.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // Fixed, so the bar's height never depends on the field's contents.
    height: 40,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceSoft,
    borderWidth: 1,
    borderColor: color.line,
  },
  input: {
    flex: 1,
    // No vertical padding: the fixed-height parent centres it, and padding on
    // Android would push the text off centre.
    paddingVertical: 0,
    fontFamily: font.medium,
    fontSize: 14.5,
    color: color.ink,
  },
  clearPressed: { opacity: 0.6 },
});
