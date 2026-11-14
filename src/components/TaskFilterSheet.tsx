import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DueFilter } from '@/features/tasks/filter';
import { color, font, radius, shadow } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Body, SectionLabel, Tiny } from './Text';

/**
 * The deadline filter — a button in the top bar, and the sheet it opens.
 *
 * It lived as a row of chips under the lane tabs before this, and that was the
 * problem: five pills of the same size and shape on consecutive rows read as
 * one group of five choices, so "Active" and "Overdue" looked like
 * alternatives when one picks the set and the other narrows it. Moving it into
 * the bar beside the search puts it with the other thing that narrows a list,
 * and leaves the lanes alone to be what they are.
 *
 * A sheet rather than a dropdown: there is nothing to measure or anchor, it
 * works the same on both platforms, and it has room to say what each option
 * means — which matters for "Due today", whose definition is not obvious.
 */

/**
 * The options, as a single-select list including its own "off" row.
 *
 * Written as three choices rather than two toggles because that is what it is:
 * one value with three states. Two independent-looking switches where turning
 * one on turns the other off is a worse lie than the extra row costs.
 */
const OPTIONS: { id: DueFilter; label: string; hint: string; icon: IconName }[] = [
  {
    id: 'all',
    label: 'All jobs',
    hint: 'No deadline filter',
    icon: 'inbox',
  },
  {
    id: 'today',
    label: 'Due today',
    hint: 'Has to be done by tonight — includes anything already late',
    icon: 'clock',
  },
  {
    id: 'overdue',
    label: 'Overdue',
    hint: 'The deadline has already passed',
    icon: 'alert-circle',
  },
];

/**
 * The button that opens it, sized to sit beside the search field.
 *
 * Lights amber while a filter is on, and that is load-bearing rather than
 * decoration: a filter the driver has forgotten about makes their run look
 * short, and the only thing standing between them and that is this button
 * looking different. The list's own empty state carries the same message in
 * words for when it hides everything.
 */
export function FilterButton({ due, onPress }: { due: DueFilter; onPress: () => void }) {
  const active = due !== 'all';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        active
          ? `Filters, ${due === 'overdue' ? 'showing overdue only' : 'showing jobs due today'}`
          : 'Filters'
      }
      accessibilityState={{ expanded: false }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        active ? styles.buttonOn : null,
        pressed ? styles.pressed : null,
      ]}
      hitSlop={6}
    >
      <Icon name="filter" size={17} color={active ? color.warn : color.muted} />

      {/*
        A dot, not a count. There is only ever one filter on, so a number would
        always be "1" — the dot says the same thing without reading as a badge
        of unread work.
      */}
      {active ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

export function TaskFilterSheet({
  visible,
  due,
  onSelect,
  onClose,
}: {
  visible: boolean;
  due: DueFilter;
  onSelect: (next: DueFilter) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Android's back button has to dismiss this, or it leaves the screen.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/*
        The backdrop is the dismiss target. `accessibilityViewIsModal` keeps a
        screen reader inside the sheet rather than letting it wander the list
        underneath, which is still mounted.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close filters"
        style={styles.backdrop}
        onPress={onClose}
      />

      <View
        accessibilityViewIsModal
        style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}
      >
        {/* The grab handle is decoration — the backdrop and back button dismiss. */}
        <View style={styles.handle} />

        <SectionLabel style={styles.heading}>Show</SectionLabel>

        {OPTIONS.map((option) => {
          const selected = option.id === due;

          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => {
                onSelect(option.id);
                // Closes on choice. It is a single-select with three options,
                // so there is nothing further to do here and a Done button
                // would just be a second tap for every filter change.
                onClose();
              }}
              style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
            >
              <View style={[styles.rowIcon, selected ? styles.rowIconOn : null]}>
                <Icon
                  name={option.icon}
                  size={15}
                  color={selected ? color.warn : color.muted}
                />
              </View>

              <View style={styles.rowText}>
                <Body style={[styles.rowLabel, selected ? styles.rowLabelOn : null]}>
                  {option.label}
                </Body>
                <Tiny style={styles.rowHint}>{option.hint}</Tiny>
              </View>

              {selected ? <Icon name="check" size={17} color={color.warn} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceSoft,
    borderWidth: 1,
    borderColor: color.line,
  },
  buttonOn: { backgroundColor: color.warnSoft, borderColor: color.warnSoft },
  pressed: { opacity: 0.7 },
  dot: {
    position: 'absolute',
    top: 7,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: color.warn,
  },

  backdrop: { flex: 1, backgroundColor: 'rgba(26, 26, 46, 0.4)' },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: 14,
    paddingTop: 8,
    gap: 2,
    ...shadow.float,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.ctrl,
    marginBottom: 10,
  },
  heading: { marginBottom: 4, paddingHorizontal: 2 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // Comfortably past the 44pt minimum: this is tapped in a moving van.
    minHeight: 58,
    paddingHorizontal: 2,
  },
  rowPressed: { backgroundColor: color.surfaceSoft, borderRadius: radius.md },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bgCanvas,
  },
  rowIconOn: { backgroundColor: color.warnSoft },
  rowText: { flex: 1, gap: 1 },
  rowLabel: { fontSize: 15, fontFamily: font.semibold },
  rowLabelOn: { color: color.warn, fontFamily: font.bold },
  rowHint: { fontSize: 11.5, color: color.muted, lineHeight: 16 },
});
