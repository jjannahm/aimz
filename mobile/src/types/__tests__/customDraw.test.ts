import { ADVANCE_PER_GROUP, describeCustomDraw, KNOCKOUT_TEAM_COUNTS } from '@/src/types/api';

describe('describeCustomDraw', () => {
  it('accepts a draw whose groups halve down to a final', () => {
    expect(describeCustomDraw(2, 4)).toBeNull();
    expect(describeCustomDraw(4, 6)).toBeNull();
    expect(describeCustomDraw(8, 3)).toBeNull();
  });

  it('turns down a group nobody could play in', () => {
    expect(describeCustomDraw(4, 1)).toMatch(/at least 2 teams/u);
    expect(describeCustomDraw(1, 4)).toMatch(/at least 2 groups/u);
  });

  // Six groups send twelve through, and twelve teams have no bracket without
  // byes — which is why the shape is refused while it is being typed.
  it('turns down a group count that will not halve', () => {
    expect(describeCustomDraw(6, 4)).toMatch(/12 teams through/u);
    expect(describeCustomDraw(3, 5)).toMatch(/6 teams through/u);
  });

  it('leaves every preset valid', () => {
    for (const count of KNOCKOUT_TEAM_COUNTS) expect(describeCustomDraw(count / 4, 4)).toBeNull();
  });

  it('sends two from every group', () => {
    expect(ADVANCE_PER_GROUP).toBe(2);
  });
});
