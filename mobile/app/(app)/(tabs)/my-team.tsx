import { Redirect } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AnnouncementsSection } from '@/src/components/myTeam/AnnouncementsSection';
import { ScheduleSection } from '@/src/components/myTeam/ScheduleSection';
import { Screen } from '@/src/components/Screen';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

const sections = [{ key: 'schedule', label: 'Schedule' }, { key: 'announcements', label: 'Announcements' }] as const;
type Section = (typeof sections)[number]['key'];

export default function HubScreen() {
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  const [selected, setSelected] = React.useState<Section>('schedule');
  if (user?.role === 'admin') return <Redirect href="/(app)/(tabs)" />;
  return <Screen title="Hub"><ScrollView contentContainerStyle={styles.chips} horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar}>{sections.map((section) => <Pressable accessibilityLabel={section.label} accessibilityRole="tab" accessibilityState={{ selected: selected === section.key }} key={section.key} onPress={() => setSelected(section.key)} style={({ pressed }) => [styles.chip, selected === section.key && styles.active, pressed && styles.pressed]}><Text style={[styles.text, selected === section.key && styles.activeText]}>{section.label}</Text></Pressable>)}</ScrollView>{selected === 'schedule' ? <ScheduleSection /> : <AnnouncementsSection />}</Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ active: { backgroundColor: colors.accent, borderColor: colors.accent }, activeText: { color: colors.onAccent, fontWeight: '900' }, chip: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.pill, borderWidth: 1, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md }, chipBar: { flexGrow: 0 }, chips: { gap: theme.spacing.sm }, pressed: { opacity: 0.7 }, text: { color: colors.textSecondary, fontWeight: '800' } });
