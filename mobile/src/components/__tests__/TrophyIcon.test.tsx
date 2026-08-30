import { render } from '@testing-library/react-native';

import { TrophyIcon } from '@/src/components/TrophyIcon';
import { darkColors } from '@/src/theme';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const hidden = { includeHiddenElements: true } as const;
/** The blur the layer is drawn with, which is the whole of the glow. */
const radius = (style: unknown) => (Array.isArray(style) ? style.flat() : [style])
  .reduce<number>((found, part) => (part && typeof part === 'object' && 'textShadowRadius' in part ? (part as { textShadowRadius: number }).textShadowRadius : found), 0);

describe('TrophyIcon', () => {
  it('lights the gold with a halo under the glyph, not one shadow over it', async () => {
    const screen = await render(<TrophyIcon size={20} />);
    const halo = screen.getByTestId('trophy-halo', hidden);
    const glyph = screen.getByTestId('trophy-glyph', hidden);

    expect(halo.props.color).toBe(darkColors.trophyGlow);
    expect(glyph.props.color).toBe(darkColors.trophy);
    // Warm and wide beneath bright and tight. A single text shadow is thin at
    // this size and reads as an outline rather than as light, so if the halo
    // ever stops being the wider of the two the glow has gone.
    expect(radius(halo.props.style)).toBeGreaterThan(radius(glyph.props.style));
  });

  it('keeps the name a screen reader reads, which moved off the glyph onto a wrapper', async () => {
    const screen = await render(<TrophyIcon accessibilityLabel="First place" size={16} />);
    expect(screen.getByLabelText('First place').props.accessible).toBe(true);
  });

  it('hides the decorative one, which sits beside copy that already says it', async () => {
    const screen = await render(<TrophyIcon size={20} />);
    expect(screen.queryByTestId('trophy-icon')).toBeNull();
    expect(screen.getByTestId('trophy-icon', hidden)).toBeTruthy();
  });

  it('draws a trophy still being played for cold, with nothing to light up', async () => {
    const screen = await render(<TrophyIcon dimmed size={20} />);
    expect(screen.getByTestId('trophy-glyph', hidden).props.color).toBe(darkColors.textMuted);
    expect(screen.queryByTestId('trophy-halo', hidden)).toBeNull();
  });

  it('uses the hollow glyph where the log draws its row chips in outline', async () => {
    const screen = await render(<TrophyIcon outline size={18} />);
    expect(screen.getByTestId('trophy-halo', hidden).props.name).toBe('trophy-outline');
    expect(screen.getByTestId('trophy-glyph', hidden).props.name).toBe('trophy-outline');
  });
});
