import { confirmManageSave, confirmManageWrite, manageToastMessage } from '@/src/lib/manageToasts';
import { showToast } from '@/src/lib/platformAlert';

jest.mock('@/src/lib/platformAlert', () => ({ showToast: jest.fn() }));

describe('manageToastMessage', () => {
  it('says what the user asked every section to say', () => {
    expect(manageToastMessage('match', 'created')).toBe('Match created');
    expect(manageToastMessage('match', 'saved')).toBe('Match saved');
    expect(manageToastMessage('announcement', 'created')).toBe('Announcement published');
    expect(manageToastMessage('announcement', 'saved')).toBe('Announcement saved');
  });

  it('covers every other section of Manage in the same shape', () => {
    expect(manageToastMessage('team', 'created')).toBe('Squad created');
    expect(manageToastMessage('opponent', 'saved')).toBe('Opponent saved');
    expect(manageToastMessage('competition', 'created')).toBe('Competition created');
    expect(manageToastMessage('player', 'saved')).toBe('Player saved');
  });

  // The message this whole change is being made to match.
  it('leaves the training schedule wording exactly as it was', () => {
    expect(manageToastMessage('schedule', 'created')).toBe('Training schedule saved');
  });

  it('uses the verb each action is actually called by', () => {
    expect(manageToastMessage('invite', 'created')).toBe('Invitation created');
    // Revoked, because that is the word the button uses.
    expect(manageToastMessage('invite', 'deleted')).toBe('Invitation revoked');
    expect(manageToastMessage('player', 'deleted')).toBe('Player deleted');
  });

  it('never leaves a section without wording', () => {
    const entities = ['team', 'opponent', 'competition', 'player', 'players', 'match', 'invite', 'announcement', 'schedule', 'session', 'series', 'photo', 'roster', 'result'] as const;
    for (const entity of entities) {
      for (const action of ['created', 'saved', 'deleted'] as const) {
        const message = manageToastMessage(entity, action);
        expect(message).toMatch(/^\S.*\s\S+$/u);
        expect(message).not.toMatch(/undefined/u);
      }
    }
  });
});

describe('confirmManageWrite', () => {
  beforeEach(() => jest.mocked(showToast).mockClear());

  it('raises the app\'s existing toast rather than a new kind of message', () => {
    confirmManageWrite('match', 'created');
    expect(showToast).toHaveBeenCalledWith('Match created');
  });

  // Every Manage form keeps the item under edit in state, so this is the one
  // check that decides "created" from "saved" everywhere.
  it('tells a new thing from a change by what was being edited', () => {
    confirmManageSave('match', null);
    expect(showToast).toHaveBeenLastCalledWith('Match created');
    confirmManageSave('match', { id: 'm-1' });
    expect(showToast).toHaveBeenLastCalledWith('Match saved');
  });
});
