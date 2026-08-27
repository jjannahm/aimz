import { Image } from 'react-native';

import { TeamBadge } from '@/src/components/TeamBadge';
import { mediaUrl } from '@/src/lib/mediaUrl';
import type { BadgeStyle } from '@/src/types/api';

export { initialsFor } from '@/src/components/TeamBadge';

type Props = {
  name: string;
  logoUrl?: string | null;
  size?: number;
  /** AIMZ squads wear the club crest; everyone else gets the opponent shield. */
  isAimz?: boolean;
  /** Overrides `isAimz` when the team has been given a badge of its own. */
  badgeStyle?: BadgeStyle | null;
};

/**
 * A team's crest. An uploaded logo still wins; otherwise the badge is drawn
 * from the team's own choice, falling back to whether the team is ours.
 */
export function TeamAvatar({ name, logoUrl, size = 44, isAimz, badgeStyle }: Props) {
  const uri = mediaUrl(logoUrl);
  if (uri) {
    return <Image accessibilityElementsHidden source={{ uri }} style={{ borderRadius: size / 2, height: size, width: size }} />;
  }
  return <TeamBadge badgeStyle={badgeStyle} isAimz={isAimz} name={name} size={size} />;
}
