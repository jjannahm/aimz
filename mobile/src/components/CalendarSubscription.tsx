import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { ApiError, api } from '@/src/lib/api';
import { confirmAction, showMessage, showToast } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { CalendarFeed } from '@/src/types/api';

export const calendarFeedKey = ['calendar-feed'] as const;

type Props = {
  placement: 'hub' | 'settings';
};

const webcalUrl = (url: string) => url.replace(/^https?:/u, 'webcal:');

async function shareCalendar(url: string): Promise<void> {
  await Share.share({
    message: `Subscribe to my AIMZ fixtures and training calendar: ${url}`,
    title: 'AIMZ calendar',
    url,
  });
}

async function openCalendar(url: string): Promise<void> {
  try {
    const subscriptionUrl = webcalUrl(url);
    if (await Linking.canOpenURL(subscriptionUrl)) {
      await Linking.openURL(subscriptionUrl);
      return;
    }
  } catch {
    // Android and some browsers have no webcal handler. Sharing the HTTPS
    // address lets it be pasted into Google Calendar or sent to another device.
  }
  await shareCalendar(url);
}

function connectedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Calendar connected';
  return `Connected ${new Intl.DateTimeFormat('en-EG', { dateStyle: 'medium' }).format(date)}`;
}

export function CalendarSubscription({ placement }: Props) {
  const { user } = useAuth();
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const enabled = Boolean(user && user.role !== 'admin');
  const feed = useQuery({
    queryKey: calendarFeedKey,
    queryFn: api.calendarFeed,
    enabled,
    // The Hub prompt is allowed to disappear as soon as the user returns to
    // the schedule after a calendar client has made its first fetch.
    staleTime: placement === 'hub' ? 0 : 30_000,
  });
  const regenerate = useMutation({
    mutationFn: api.regenerateCalendarFeed,
    onError: (error) => showMessage('Calendar link not regenerated', (error as ApiError).message),
    onSuccess: (next) => {
      client.setQueryData<CalendarFeed>(calendarFeedKey, next);
      showToast('New calendar link ready');
    },
  });

  if (!enabled || (placement === 'hub' && feed.data?.subscribed_at)) return null;

  const open = async () => {
    if (!feed.data) return;
    try {
      await openCalendar(feed.data.url);
    } catch {
      showMessage('Calendar did not open', 'Share the subscription link and add it to Apple, Google or Outlook Calendar.');
    }
  };
  const share = async () => {
    if (!feed.data) return;
    try {
      await shareCalendar(feed.data.url);
    } catch {
      showMessage('Calendar link not shared', 'Try again, or open the subscription directly.');
    }
  };
  const reset = () => confirmAction(
    'Regenerate calendar link?',
    'Your existing calendar subscription will stop updating. Add the new link to every device you still use.',
    'Regenerate',
    () => regenerate.mutate(),
    { destructive: true },
  );

  return (
    <View accessibilityLabel="Calendar subscription" style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.heading}>{placement === 'hub' ? 'Your schedule, in your calendar' : 'Calendar subscription'}</Text>
        <Text style={styles.meta}>
          {feed.isLoading
            ? 'Preparing your private calendar link…'
            : feed.isError
              ? (feed.error as ApiError).message
              : placement === 'hub'
                ? 'Add matches and training once. Changes then arrive automatically.'
                : feed.data?.subscribed_at
                  ? connectedLabel(feed.data.subscribed_at)
                  : 'Not connected yet. The private link includes matches and training for your squad.'}
        </Text>
      </View>
      {feed.isError
        ? <AppButton label="Try again" onPress={() => feed.refetch()} variant="secondary" />
        : feed.data
          ? <View style={styles.actions}>
            <AppButton icon="calendar-outline" label={feed.data.subscribed_at ? 'Add on another device' : 'Subscribe to calendar'} onPress={open} />
            <AppButton icon="share-outline" label="Share subscription link" onPress={share} variant="secondary" />
            {placement === 'settings' ? <AppButton disabled={regenerate.isPending} label="Regenerate link" loading={regenerate.isPending} onPress={reset} variant="danger" /> : null}
          </View>
          : null}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  actions: { gap: theme.spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    gap: theme.spacing.md,
    padding: theme.size.cardPadding,
  },
  copy: { gap: theme.spacing.xs },
  heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  meta: { color: colors.textMuted, fontFamily: theme.font.regular, fontSize: theme.type.label, lineHeight: 20 },
});
