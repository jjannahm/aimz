import { Image, StyleSheet, Text, View } from 'react-native';

import { type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type Tone = 'accent' | 'light';

type Props = {
  name: string;
  logoUrl?: string | null;
  size?: number;
  /** Pin the circle colour instead of deriving it from the name. */
  tone?: Tone;
};

/** "AIMZ U18 Women" -> "AU", "Zamalek" -> "ZA". */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? (words[0] ?? '').slice(0, 2) : `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`;
  return letters.toUpperCase();
}

// Stable per name so a team keeps the same colour everywhere it appears.
function toneFor(name: string): Tone {
  let hash = 0;
  for (const character of name) hash = (hash + character.codePointAt(0)!) % 2048;
  return hash % 2 === 0 ? 'accent' : 'light';
}

export function TeamAvatar({ name, logoUrl, size = 44, tone }: Props) {
  const styles = useThemedStyles(stylesheet);
  const circle = { borderRadius: size / 2, height: size, width: size };
  if (logoUrl) return <Image accessibilityElementsHidden source={{ uri: logoUrl }} style={circle} />;
  const resolved = tone ?? toneFor(name);
  return <View accessibilityElementsHidden style={[styles.fallback, circle, resolved === 'accent' ? styles.accent : styles.light]}>
    <Text style={[styles.initials, { fontSize: Math.max(11, Math.round(size * 0.36)) }]}>{initialsFor(name)}</Text>
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  accent: { backgroundColor: colors.accent },
  light: { backgroundColor: colors.accentSoft },
  initials: { color: colors.onAccent, fontWeight: '900', letterSpacing: 0.3 },
});
