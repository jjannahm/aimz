import { Linking, Share } from 'react-native';

/**
 * Handing a subscription URL to whatever calendar the reader already uses.
 *
 * Shared by the Settings card and the Hub's calendar button. Both need the
 * `webcal:` attempt and the same fallback when there is nothing to handle it,
 * and two copies of that would drift.
 */

export const calendarFeedKey = ['calendar-feed'] as const;

/**
 * `webcal:` is what tells a calendar to subscribe rather than download once.
 * Apple, Google and Outlook all register for it.
 */
export const webcalUrl = (url: string) => url.replace(/^https?:/u, 'webcal:');

export async function shareCalendar(url: string): Promise<void> {
  await Share.share({
    message: `Subscribe to my AIMZ fixtures and training calendar: ${url}`,
    title: 'AIMZ calendar',
    url,
  });
}

export async function openCalendar(url: string): Promise<void> {
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

/** "Connected Aug 30, 2026", or a plain line when the date will not parse. */
export function connectedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Calendar connected';
  return `Connected ${new Intl.DateTimeFormat('en-EG', { dateStyle: 'medium' }).format(date)}`;
}
