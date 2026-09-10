import { Share } from 'react-native';

import { appConfig } from '@/src/config';

/**
 * The address a parents' group is given for a match report.
 *
 * A page on the app rather than the API, the same bargain the player report
 * link strikes: what somebody opens should be something to read, not JSON.
 * The token is the whole of the credential.
 */
export const matchReportShareUrl = (token: string) => `${appConfig.webOrigin}/m/${encodeURIComponent(token)}`;

/** "AIMZ U12 3–1 Wadi Degla" — the scoreline, as it would be said aloud. */
export const matchHeadline = (home: string, homeScore: number, awayScore: number, away: string) =>
  `${home} ${homeScore}–${awayScore} ${away}`;

/**
 * Hands the address to whatever the reader shares with — which here is very
 * often a parents' WhatsApp group. The same OS share sheet the player report
 * and the calendar link already use.
 */
export async function shareMatchReport(token: string, headline: string): Promise<void> {
  const url = matchReportShareUrl(token);
  await Share.share({ message: `${headline} — AIMZ match report: ${url}`, title: 'AIMZ match report', url });
}
