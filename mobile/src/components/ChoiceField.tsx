import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

type Option = { label: string; value: string };
type Anchor = { x: number; y: number; width: number; height: number };

const MENU_GAP = theme.spacing.xs;
const SCREEN_GUTTER = theme.spacing.md;
const OPTION_HEIGHT = 48;
const MAX_MENU_HEIGHT = 280;

export function getDropdownLayout(anchor: Anchor, optionCount: number, windowWidth: number, windowHeight: number) {
  const width = Math.min(anchor.width, Math.max(0, windowWidth - SCREEN_GUTTER * 2));
  const left = Math.min(
    Math.max(anchor.x, SCREEN_GUTTER),
    Math.max(SCREEN_GUTTER, windowWidth - SCREEN_GUTTER - width),
  );
  const desiredHeight = Math.min(MAX_MENU_HEIGHT, Math.max(OPTION_HEIGHT, optionCount * OPTION_HEIGHT + 2));
  const belowTop = anchor.y + anchor.height + MENU_GAP;
  const availableBelow = Math.max(0, windowHeight - SCREEN_GUTTER - belowTop);
  const availableAbove = Math.max(0, anchor.y - SCREEN_GUTTER - MENU_GAP);
  const opensAbove = availableBelow < desiredHeight && availableAbove > availableBelow;
  const availableHeight = opensAbove ? availableAbove : availableBelow;
  const maxHeight = Math.min(desiredHeight, Math.max(OPTION_HEIGHT, availableHeight));
  const top = opensAbove ? Math.max(SCREEN_GUTTER, anchor.y - MENU_GAP - maxHeight) : belowTop;

  return { left, maxHeight, opensAbove, top, width };
}

export function ChoiceField({ label, value, options, onChange, placeholder = 'Choose one', error }: { label: string; value?: string; options: Option[]; onChange: (value: string) => void; placeholder?: string; error?: string }) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [fieldSize, setFieldSize] = useState({ height: 52, width: 0 });
  const triggerRef = useRef<View>(null);
  const initialOptionRef = useRef<View>(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const selected = options.find((item) => item.value === value);

  const measureAnchor = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof trigger.measureInWindow !== 'function') return;
    trigger.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setAnchor({ x, y, width, height });
    });
  }, []);

  const openDropdown = (event: GestureResponderEvent) => {
    const { locationX, locationY, pageX, pageY } = event.nativeEvent;
    const width = fieldSize.width || Math.max(0, windowWidth - SCREEN_GUTTER * 2);
    setAnchor({
      x: Number.isFinite(pageX) && Number.isFinite(locationX) ? pageX - locationX : SCREEN_GUTTER,
      y: Number.isFinite(pageY) && Number.isFinite(locationY) ? pageY - locationY : SCREEN_GUTTER,
      width,
      height: fieldSize.height,
    });
    setOpen(true);
  };

  const close = useCallback(() => {
    setOpen(false);
    setAnchor(null);
    if (Platform.OS === 'web') requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (open) measureAnchor();
  }, [measureAnchor, open, windowHeight, windowWidth]);

  useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close, open]);

  const dropdown = anchor ? getDropdownLayout(anchor, options.length, windowWidth, windowHeight) : null;
  const initialFocusValue = selected?.value ?? options[0]?.value;

  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityHint={`Opens ${label} choices`}
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onLayout={(event) => setFieldSize({ height: event.nativeEvent.layout.height, width: event.nativeEvent.layout.width })}
        onPress={openDropdown}
        ref={triggerRef}
        style={({ pressed }) => [styles.field, error && styles.fieldError, open && styles.fieldOpen, pressed && styles.pressed]}
        testID="choice-trigger"
      >
        <Text numberOfLines={1} style={[styles.value, !selected && styles.placeholder]}>{selected?.label ?? placeholder}</Text>
        <Ionicons accessible={false} color={colors.textMuted} importantForAccessibility="no" name={open ? 'chevron-up' : 'chevron-down'} size={20} />
      </Pressable>
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      <Modal
        animationType="none"
        onOrientationChange={() => measureAnchor()}
        onRequestClose={close}
        onShow={() => {
          if (Platform.OS === 'web') initialOptionRef.current?.focus();
        }}
        testID="choice-modal"
        transparent
        visible={open}
      >
        <View accessibilityViewIsModal style={styles.overlay}>
          <Pressable accessible={false} onPress={close} style={StyleSheet.absoluteFill} testID="choice-backdrop" />
          {dropdown ? (
            <View
              accessibilityLabel={`${label} choices`}
              style={[styles.menu, { left: dropdown.left, maxHeight: dropdown.maxHeight, top: dropdown.top, width: dropdown.width }]}
              testID="choice-menu"
            >
              <ScrollView
                bounces={false}
                contentContainerStyle={styles.options}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={options.length * OPTION_HEIGHT > dropdown.maxHeight}
                testID="choice-options"
              >
                {options.map((option, index) => {
                  const isSelected = option.value === value;
                  return (
                    <Pressable
                      accessibilityLabel={option.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      key={option.value}
                      onPress={() => {
                        onChange(option.value);
                        close();
                      }}
                      ref={option.value === initialFocusValue ? initialOptionRef : undefined}
                      style={({ pressed }) => [
                        styles.option,
                        index > 0 && styles.optionDivider,
                        isSelected && styles.optionSelected,
                        pressed && styles.optionPressed,
                      ]}
                    >
                      <Text numberOfLines={1} style={[styles.optionText, isSelected && styles.optionTextSelected]}>{option.label}</Text>
                      {isSelected ? <Ionicons accessible={false} color={colors.accentSoft} importantForAccessibility="no" name="checkmark" size={20} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  group: { gap: theme.spacing.xs },
  label: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '700' },
  field: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: theme.spacing.md },
  fieldError: { borderColor: colors.error },
  fieldOpen: { borderColor: colors.accent },
  value: { color: colors.textPrimary, flex: 1, fontSize: theme.type.body, marginRight: theme.spacing.sm },
  placeholder: { color: colors.textMuted },
  error: { color: colors.errorText, fontSize: theme.type.caption },
  pressed: { opacity: 0.7 },
  overlay: { flex: 1 },
  menu: { backgroundColor: colors.surfaceRaised, borderColor: colors.accent, borderRadius: theme.radius.md, borderWidth: 1, elevation: 12, overflow: 'hidden', position: 'absolute', shadowColor: colors.background, shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.45, shadowRadius: 14 },
  options: { flexGrow: 1 },
  option: { alignItems: 'center', backgroundColor: colors.surfaceRaised, flexDirection: 'row', justifyContent: 'space-between', minHeight: OPTION_HEIGHT, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  optionDivider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  optionSelected: { backgroundColor: colors.highlightedSurface },
  optionPressed: { opacity: 0.72 },
  optionText: { color: colors.textSecondary, flex: 1, fontSize: theme.type.body, fontWeight: '700', marginRight: theme.spacing.sm },
  optionTextSelected: { color: colors.textPrimary },
});
