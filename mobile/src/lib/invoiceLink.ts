import { Share } from 'react-native';

import { appConfig } from '@/src/config';
import { formatEgpRound } from '@/src/lib/money';

/**
 * The address a family is given for an invoice.
 *
 * A page on the app rather than the API, the same bargain both report links
 * strike: what a parent opens should be something to read, not JSON. The token
 * is the whole of the credential.
 */
export const invoiceShareUrl = (token: string) => `${appConfig.webOrigin}/i/${encodeURIComponent(token)}`;

/**
 * Hands the address to whatever the reader shares with — very often the
 * parent's own WhatsApp thread. The amount is in the message as well as on the
 * page, so the ask is legible before anybody taps anything.
 *
 * Sent to one family rather than a group: it names their child and what they
 * owe.
 */
export async function shareInvoice(token: string, playerName: string, outstandingPiastres: number): Promise<void> {
  const url = invoiceShareUrl(token);
  const message = `AIMZ invoice for ${playerName} — ${formatEgpRound(outstandingPiastres)} due: ${url}`;
  await Share.share({ message, title: 'AIMZ invoice', url });
}
