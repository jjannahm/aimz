import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { CollapsibleCard } from '@/src/components/CollapsibleCard';
import { ApiError, api } from '@/src/lib/api';
import { calendarFeedKey, connectedLabel, openCalendar, shareCalendar } from '@/src/lib/calendarLink';
import { confirmAction, showMessage, showToast } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { CalendarFeed } from '@/src/types/api';

/**
 * Everything a reader can do to their calendar subscription, folded away.
 *
 * Settings only. The Hub reaches the same feed through the calendar button in
 * its header, which is one tap rather than a card across the top of the page.
 * Collapsed by default like the cards either side of it, with the state that
 * matters — whether a calendar has actually picked the feed up — readable
 * without opening it.
 */
export function CalendarSubscription() {
  const { user } = useAuth();
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const enabled = Boolean(user && user.role !== 'admin');
  const feed = useQuery({ queryKey: calendarFeedKey, queryFn: api.calendarFeed, enabled, staleTime: 30_000 });

  const openFeed = async (url: string) => {
    try {
      await openCalendar(url);
    } catch {
      showMessage('Calendar did not open', 'Share the subscription link and add it to Apple, Google or Outlook Calendar.');
    }
  };
  const failed = (error: unknown) => showMessage('Calendar not updated', (error as ApiError).message);

  const create = useMutation({
    mutationFn: api.createCalendarFeed,
    onError: failed,
    // Straight into the calendar, since asking to set one up and then being
    // handed a link to press again is a step that says nothing.
    onSuccess: (next: CalendarFeed) => { client.setQueryData(calendarFeedKey, next); if (next.url) void openFeed(next.url); },
  });
  const regenerate = useMutation({
    mutationFn: api.regenerateCalendarFeed,
    onError: failed,
    onSuccess: (next: CalendarFeed) => { client.setQueryData(calendarFeedKey, next); showToast('New calendar link ready'); },
  });
  const remove = useMutation({
    mutationFn: api.removeCalendarFeed,
    onError: failed,
    onSuccess: () => {
      client.setQueryData<CalendarFeed>(calendarFeedKey, { url: null, subscribed_at: null });
      showToast('Calendar subscription removed');
    },
  });

  if (!enabled) return null;

  const share = async () => {
    if (!feed.data?.url) return;
    try {
      await shareCalendar(feed.data.url);
    } catch {
      showMessage('Calendar link not shared', 'Try again, or open the subscription directly.');
    }
  };
  const confirmRegenerate = () => confirmAction(
    'Regenerate calendar link?',
    'Your existing calendar subscription will stop updating. Add the new link to every device you still use.',
    'Regenerate',
    () => regenerate.mutate(),
    { destructive: true },
  );
  // Spelled out because this is not undo: setting up again gives a different
  // address, so every device has to be told about it a second time.
  const confirmRemove = () => confirmAction(
    'Remove calendar subscription?',
    'Matches and training stop arriving in every calendar you have added this to. Setting it up again creates a different link.',
    'Remove',
    () => remove.mutate(),
    { destructive: true },
  );

  const summary = feed.isLoading
    ? 'Checking your calendar…'
    : feed.isError
      ? (feed.error as ApiError).message
      : feed.data?.url
        ? feed.data.subscribed_at
          ? connectedLabel(feed.data.subscribed_at)
          : 'Link ready, not yet added to a calendar.'
        : 'Matches and training, in the calendar you already use.';

  return (
    <CollapsibleCard summary={summary} title="Calendar subscription">
      {feed.isError
        ? <AppButton label="Try again" onPress={() => feed.refetch()} variant="secondary" />
        : feed.data?.url
          ? <View style={styles.actions} testID="calendar-actions">
            <AppButton icon="calendar-outline" label="Add on another device" onPress={() => openFeed(feed.data!.url!)} />
            <AppButton icon="share-outline" label="Share subscription link" onPress={share} variant="secondary" />
            <AppButton disabled={regenerate.isPending} label="Regenerate link" loading={regenerate.isPending} onPress={confirmRegenerate} variant="danger" />
            <AppButton disabled={remove.isPending} label="Remove subscription" loading={remove.isPending} onPress={confirmRemove} variant="danger" />
          </View>
          : <View style={styles.actions} testID="calendar-actions">
            <Text style={styles.meta}>The private link covers every squad your family is on, and nothing else.</Text>
            <AppButton disabled={create.isPending} icon="calendar-outline" label="Set up calendar" loading={create.isPending} onPress={() => create.mutate()} />
          </View>}
    </CollapsibleCard>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  actions: { gap: theme.spacing.sm },
  meta: { color: colors.textMuted, fontFamily: theme.font.regular, fontSize: theme.type.label, lineHeight: 20 },
});
