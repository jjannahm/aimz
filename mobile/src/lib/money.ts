/**
 * Money, in whole piastres.
 *
 * The API stores and returns piastres — hundredths of an Egyptian pound —
 * because a float cannot hold 12.30 and money that drifts is worse than money
 * that is awkward. Nothing outside this file should divide by a hundred.
 */
const PIASTRES_IN_POUND = 100;

const formatter = new Intl.NumberFormat('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `120000` reads as `1,200.00 EGP`. */
export function formatEgp(piastres: number): string {
  const negative = piastres < 0;
  const pounds = Math.abs(piastres) / PIASTRES_IN_POUND;
  return `${negative ? '−' : ''}${formatter.format(pounds)} EGP`;
}

/** The same amount without the currency, for a field a number is typed into. */
export function poundsOf(piastres: number): string {
  return (piastres / PIASTRES_IN_POUND).toFixed(2);
}

/**
 * What somebody typed, as piastres, or null when it is not an amount.
 *
 * Accepts what a person actually types: grouping commas, a stray currency
 * name, more than two decimal places. Rounds rather than truncates, so 0.005
 * does not quietly become nothing.
 */
export function parseEgp(text: string): number | null {
  const cleaned = text.replace(/[,\s]/gu, '').replace(/egp/giu, '');
  if (!/^-?\d*\.?\d*$/u.test(cleaned) || !/\d/u.test(cleaned)) return null;
  const pounds = Number(cleaned);
  if (!Number.isFinite(pounds)) return null;
  return Math.round(pounds * PIASTRES_IN_POUND);
}

/**
 * The same amount, without the decimals when there are none: `3,600 EGP`.
 *
 * For a report, which says what a family owes rather than accounting for it.
 * The ledger keeps `formatEgp`, because a screen where money is taken has to
 * show the exact figure.
 */
export function formatEgpRound(piastres: number): string {
  return piastres % PIASTRES_IN_POUND === 0
    ? `${piastres < 0 ? '−' : ''}${new Intl.NumberFormat('en-EG').format(Math.abs(piastres) / PIASTRES_IN_POUND)} EGP`
    : formatEgp(piastres);
}
