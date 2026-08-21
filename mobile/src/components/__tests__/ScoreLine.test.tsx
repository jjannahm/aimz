import { render } from '@testing-library/react-native';

import { ScoreLine } from '@/src/components/ScoreLine';

describe('ScoreLine', () => {
  it('announces the score and renders each side separately', async () => {
    const screen = await render(<ScoreLine away={0} home={1} />);

    expect(screen.getByLabelText('1 to 0')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('–')).toBeTruthy();
  });

  it('reserves the same width either side, so the dash stays centred', async () => {
    const single = await render(<ScoreLine away={0} home={1} />);
    const wide = await render(<ScoreLine away={12} home={10} />);

    // Equal minWidth on both numbers is what holds the dash on the centre
    // line; without it a two-digit score shunts it sideways.
    const widthOf = (screen: typeof single, text: string) =>
      StyleSheetFlatten(screen.getByText(text).props.style).minWidth;
    expect(widthOf(single, '1')).toBe(widthOf(single, '0'));
    expect(widthOf(wide, '10')).toBe(widthOf(wide, '12'));
    expect(widthOf(single, '1')).toBe(widthOf(wide, '10'));
  });

  it('sets the dash smaller than the digits', async () => {
    const screen = await render(<ScoreLine away={0} home={1} />);
    const sizeOf = (text: string) => StyleSheetFlatten(screen.getByText(text).props.style).fontSize ?? 0;
    expect(sizeOf('–')).toBeLessThan(sizeOf('1'));
  });

  it('stays silent when a parent already reads the score out', async () => {
    const screen = await render(<ScoreLine away={1} decorative home={2} size="row" />);
    expect(screen.queryByLabelText('2 to 1')).toBeNull();
    expect(screen.getByText('2', { includeHiddenElements: true })).toBeTruthy();
  });
});

/** Styles arrive as nested arrays; flatten them to read a single value. */
function StyleSheetFlatten(style: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.assign(out, value);
  };
  walk(style);
  return out;
}
