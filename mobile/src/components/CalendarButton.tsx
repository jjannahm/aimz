import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { CalendarPlusIcon } from '@/src/components/CalendarPlusIcon';
import { ApiError, api } from '@/src/lib/api';
import { calendarFeedKey, openCalendar } from '@/src/lib/calendarLink';
import { confirmAction, showMessage } from '@/src/lib/platformAlert';
import { type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { CalendarFeed } from '@/src/types/api';

/**
 * The Hub's way into the calendar, beside the gear.
 *
 * It replaced a card across the top of the schedule that disappeared once a
 * calendar client had fetched the feed. An icon is small enough to leave in
 * place permanently, which matters because adding a second device is a real
 * errand — a parent with a phone and an iPad — and the header does not
 * reshuffle the moment the first fetch lands.
 *
 * Matches `SettingsButton` exactly, since the two sit as a pair.
 */
export function CalendarButton() {
  const { user } = useAuth();
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const enabled = Boolean(user && user.role !== 'admin');
  const feed = useQuery({ queryKey: calendarFeedKey, queryFn: api.calendarFeed, enabled, staleTime: 30_000 });

  const open = async (url: string) => {
    try {
      await openCalendar(url);
    } catch {
      showMessage('Calendar did not open', 'Open Settings to share the subscription link instead.');
    }
  };
  const settle = (next: CalendarFeed) => {
    client.setQueryData(calendarFeedKey, next);
    if (next.url) void open(next.url);
  };
  const failed = (error: unknown) => showMessage('Calendar not updated', (error as ApiError).message);
  const create = useMutation({ mutationFn: api.createCalendarFeed, onError: failed, onSuccess: settle });
  const regenerate = useMutation({ mutationFn: api.regenerateCalendarFeed, onError: failed, onSuccess: settle });

  if (!enabled) return null;

  /**
   * First press sets a feed up and opens it. Afterwards there is already a
   * working subscription, so the only thing left to offer is a new link — and
   * that has to ask, because regenerating silently stops the calendar updating
   * on every device it was ever added to, and this button is a header icon
   * that is easy to catch by accident.
   */
  const press = () => {
    if (create.isPending || regenerate.isPending) return;
    if (!feed.data?.url) { create.mutate(); return; }
    confirmAction(
      'Regenerate calendar link?',
      'Your existing calendar subscription will stop updating. Add the new link to every device you still use.',
      'Regenerate',
      () => regenerate.mutate(),
      { destructive: true },
    );
  };

  return (
    <Pressable
      accessibilityHint={feed.data?.url ? 'Creates a new subscription link, replacing the one you have' : 'Adds your fixtures and training to your calendar'}
      accessibilityLabel={feed.data?.url ? 'Calendar subscription' : 'Add to calendar'}
      accessibilityRole="button"
      hitSlop={10}
      onPress={press}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      testID="calendar-button"
    >
      <CalendarPlusIcon color={colors.textPrimary} size={22} />
    </Pressable>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  button: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  pressed: { opacity: 0.7 },
});
