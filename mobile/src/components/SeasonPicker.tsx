import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { noFocusRing, theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * A compact season control, sitting beside what it changes.
 *
 * It is deliberately not a `ChoiceField`: that is a labelled form control a
 * whole row wide, and this belongs on the same line as a heading. A single
 * season is shown as plain text — there is nothing to choose between.
 */
export function SeasonPicker({ season, seasons, onChange, completed = false }: {
  season: string;
  seasons: string[];
  onChange: (season: string) => void;
  /** Whether the chosen season has been ended, which the control says quietly. */
  completed?: boolean;
}) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const [open, setOpen] = useState(false);
  if (seasons.length < 2) return <Text style={styles.sole}>{season}</Text>;
  return <>
    <Pressable
      accessibilityHint="Changes which season the table and statistics show"
      accessibilityLabel={`Season ${season}${completed ? ', ended' : ''}`}
      accessibilityRole="button"
      onPress={() => setOpen(true)}
      style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      testID="season-picker"
    >
      <Text style={styles.label}>{season}</Text>
      <Ionicons accessibilityElementsHidden color={colors.onAccent} name="chevron-down" size={14} />
    </Pressable>
    <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
      {/* The scrim is a sibling of the sheet, laid under it, rather than its
        * parent: a sheet inside a pressable scrim is a button inside a button,
        * which is not valid on the web build. Drawn first, so the sheet is
        * above it and a press on the sheet never reaches it. */}
      <View style={styles.stage}>
        <Pressable accessibilityLabel="Close season list" accessibilityRole="button" onPress={() => setOpen(false)} style={styles.scrim} />
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>Season</Text>
          <ScrollView style={styles.sheetList}>
            {seasons.map((option) => <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: option === season }}
              key={option}
              onPress={() => { setOpen(false); if (option !== season) onChange(option); }}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
              testID={`season-option-${option}`}
            >
              <Text style={[styles.optionText, option === season && styles.optionOn]}>{option}</Text>
              {option === season ? <Ionicons accessibilityElementsHidden color={colors.accent} name="checkmark" size={18} /> : null}
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
