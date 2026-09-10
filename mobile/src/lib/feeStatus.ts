import type { FeeStatus } from '@/src/types/api';

/**
 * How a charge's standing is worded and coloured.
 *
 * One place, because two screens say it now — the academy's ledger in Manage
 * and a family's own record on the player profile — and a charge that reads
 * "Part paid" in amber on one and something else on the other would be two
 * apps. The standing itself is worked out by the API on read; this is only how
 * it is said.
 */
export const FEE_TONE: Record<FeeStatus, 'live' | 'warning' | 'error' | 'textMuted'> = {
  paid: 'live', partial: 'warning', overdue: 'error', unpaid: 'textMuted', void: 'textMuted', not_due: 'textMuted',
};

export const FEE_STANDING: Record<FeeStatus, string> = {
  paid: 'Paid', partial: 'Part paid', overdue: 'Overdue', unpaid: 'Unpaid', void: 'Cancelled',
  // A month the academy has not yet coached four times is not a month anybody
  // owes for, so it is neither unpaid nor late.
  not_due: 'Not due yet',
};
