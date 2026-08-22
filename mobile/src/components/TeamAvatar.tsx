import { Image } from 'react-native';

import { TeamBadge } from '@/src/components/TeamBadge';

type Props = {
  name: string;
  logoUrl?: string | null;
  size?: number;
  /** AIMZ squads wear the club crest; everyone else gets the opponent shield. */
  isAimz?: boolean;
};

/** "AIMZ U18 Women" -> "AU", "Zamalek" -> "ZA". */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? (words[0] ?? '').slice(0, 2) : `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`;
  return letters.toUpperCase();
}

/**
 * A team's crest. An uploaded logo still wins; otherwise the badge is drawn
 * from whether the team is ours.
 */
export function TeamAvatar({ logoUrl, size = 44, isAimz }: Props) {
  if (logoUrl) {
    return <Image accessibilityElementsHidden source={{ uri: logoUrl }} style={{ borderRadius: size / 2, height: size, width: size }} />;
  }
  return <TeamBadge isAimz={isAimz} size={size} />;
}
