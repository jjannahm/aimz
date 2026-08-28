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
    // A crest is a shield, not a headshot. `cover` in a round frame — which is
    // what a photo wants — cropped the tall ones to a square and then clipped
    // their corners: Al Ahly is 250x415, so it lost its stars and its point.
    // `contain` letterboxes instead, so every crest arrives whole whatever
    // shape the club draws it.
    return <Image accessibilityElementsHidden resizeMode="contain" source={{ uri }} style={{ height: size, width: size }} testID="team-logo" />;
  }
  return <TeamBadge badgeStyle={badgeStyle} isAimz={isAimz} name={name} size={size} />;
}
