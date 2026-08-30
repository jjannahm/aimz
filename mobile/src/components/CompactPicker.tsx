import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { noFocusRing, theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * A compact dropdown, sitting beside what it changes.
 *
 * Deliberately not a `ChoiceField`: that is a labelled form control a whole row
 * wide, and this belongs on the same line as a heading. A single option is
 * shown as plain text — there is nothing to choose between.
 */
export function CompactPicker({ value, options, onChange, title, label, muted = false, testID = 'compact-picker' }: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Names the list in the sheet: "Season", "Formation". */
  title: string;
  /** How the control reads to a screen reader, before the value. */
  label: string;
  /** A quiet aside on the label — a season that has ended, say. */
  muted?: string | boolean;
  testID?: string;
}) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const [open, setOpen] = useState(false);
  if (options.length < 2) return <Text style={styles.sole}>{value}</Text>;
  return <>
    <Pressable
      accessibilityLabel={`${label} ${value}${typeof muted === 'string' ? `, ${muted}` : muted ? ', ended' : ''}`}
      accessibilityRole="button"
      onPress={() => setOpen(true)}
      style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.label}>{value}</Text>
      <Ionicons accessibilityElementsHidden color={colors.onAccent} name="chevron-down" size={14} />
    </Pressable>
    <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
      {/* The scrim is a sibling of the sheet, laid under it, rather than its
        * parent: a sheet inside a pressable scrim is a button inside a button,
        * which is not valid on the web build. Drawn first, so the sheet is
        * above it and a press on the sheet never reaches it. */}
      <View style={styles.stage}>
        <Pressable accessibilityLabel="Close the list" accessibilityRole="button" onPress={() => setOpen(false)} style={styles.scrim} />
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
          <ScrollView style={styles.sheetList}>
            {options.map((option) => <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: option === value }}
              key={option}
              onPress={() => { setOpen(false); if (option !== value) onChange(option); }}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
              testID={`${testID.replace(/-picker$/u, '')}-option-${option}`}
            >
              <Text style={[styles.optionText, option === value && styles.optionOn]}>{option}</Text>
              {option === value ? <Ionicons accessibilityElementsHidden color={colors.accent} name="checkmark" size={18} /> : null}
            </Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  // The accent, the way a selected tab and the dock's marker carry it.
  control: {
    ...noFocusRing,
    alignItems: 'center', backgroundColor: colors.accent, borderColor: colors.accent,
    borderRadius: theme.radius.pill, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs,
    minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md,
  },
  label: { color: colors.onAccent, fontFamily: theme.font.semibold, fontVariant: ['tabular-nums'] },
  sole: { color: colors.textMuted, fontFamily: theme.font.medium, fontVariant: ['tabular-nums'] },

  stage: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: theme.spacing.lg },
  scrim: { backgroundColor: 'rgba(0, 0, 0, 0.5)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  sheet: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, maxHeight: '70%', padding: theme.spacing.md, width: '100%', maxWidth: 320 },
  sheetTitle: { color: colors.textMuted, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 0.6, marginBottom: theme.spacing.xs, textTransform: 'uppercase' },
  sheetList: { flexGrow: 0 },
  option: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.xs },
  optionText: { color: colors.textSecondary, fontFamily: theme.font.medium, fontVariant: ['tabular-nums'] },
  optionOn: { color: colors.textPrimary, fontFamily: theme.font.bold },
  pressed: { opacity: 0.7 },
});
