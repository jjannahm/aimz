import { Share } from 'react-native';

import { appConfig } from '@/src/config';

/**
 * The address a family is given for a report.
 *
 * A page on the app rather than the API: what a parent opens should be
 * something to read, not JSON. The token is the whole of the credential, the
 * same way a calendar subscription works.
 */
export const reportShareUrl = (token: string) => `${appConfig.webOrigin}/r/${encodeURIComponent(token)}`;

/**
 * Hands the address to whatever the reader shares with — which here is very
 * often WhatsApp. The same OS share sheet the calendar link already uses.
 */
export async function shareReport(token: string, playerName: string): Promise<void> {
  const url = reportShareUrl(token);
  await Share.share({ message: `${playerName}'s AIMZ report: ${url}`, title: 'AIMZ report', url });
}
