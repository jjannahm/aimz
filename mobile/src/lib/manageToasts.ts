import { showToast } from '@/src/lib/platformAlert';

/**
 * What the Manage tab confirms after a write.
 *
 * One place for the wording so every section of Manage says the same kind of
 * thing in the same words: adding a squad and adding a match should not read as
 * two different apps. The toast itself is the app's existing one — the green
 * check that already said "Training schedule saved" — so position, duration and
 * style come along unchanged.
 *
 * Only call these once the API has actually come back. A failure has its own
 * dialog, and a toast that fires optimistically is a lie.
 */

export type ManageEntity =
  | 'team'
  | 'opponent'
  | 'competition'
  | 'player'
  | 'players'
  | 'match'
  | 'invite'
  | 'announcement'
  | 'schedule'
  | 'session'
  | 'series'
  | 'photo'
  | 'roster'
  | 'account'
  | 'result';

export type ManageAction = 'created' | 'saved' | 'deleted';

/**
 * The noun, and any verb that is not the ordinary one for that action.
 *
 * An announcement is published rather than created, and an invitation is
 * revoked rather than deleted, because that is what those two actions are
 * called everywhere else in the app.
 */
const WORDING: Record<ManageEntity, { noun: string; created?: string; deleted?: string }> = {
  team: { noun: 'Squad' },
  opponent: { noun: 'Opponent' },
  competition: { noun: 'Competition' },
  player: { noun: 'Player' },
  players: { noun: 'Players' },
  match: { noun: 'Match' },
  invite: { noun: 'Invitation', deleted: 'revoked' },
  announcement: { noun: 'Announcement', created: 'published' },
  // Creating a schedule has always said "saved", and that is the message the
  // rest of Manage is being brought into line with, so it keeps its own word.
  schedule: { noun: 'Training schedule', created: 'saved' },
  session: { noun: 'Session' },
  series: { noun: 'Series' },
  photo: { noun: 'Photo' },
  roster: { noun: 'Private roster details' },
  // Unlinking removes the link rather than deleting the account, and saying
  // "Account deleted" over a link change would frighten an administrator.
  account: { noun: 'Account link', deleted: 'removed' },
  result: { noun: 'Final score' },
};

/** "Match created", "Announcement published", "Invitation revoked". */
export function manageToastMessage(entity: ManageEntity, action: ManageAction): string {
  const wording = WORDING[entity];
  const verb = action === 'created'
    ? wording.created ?? 'created'
    : action === 'deleted'
      ? wording.deleted ?? 'deleted'
      : 'saved';
  return `${wording.noun} ${verb}`;
}

/** Says a write went through, in the words the rest of Manage uses. */
export function confirmManageWrite(entity: ManageEntity, action: ManageAction): void {
  showToast(manageToastMessage(entity, action));
}

/**
 * Whether this was a new thing or a change to an existing one.
 *
 * Every Manage form keeps the item being edited in state and nulls it for a new
 * one, so the same check is written at every call site otherwise.
 */
export function confirmManageSave(entity: ManageEntity, editing: unknown): void {
  confirmManageWrite(entity, editing ? 'saved' : 'created');
}
