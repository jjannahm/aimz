import { Image } from 'react-native';

import { TeamBadge } from '@/src/components/TeamBadge';

export { initialsFor } from '@/src/components/TeamBadge';

type Props = {
  name: string;
  logoUrl?: string | null;
  size?: number;
  /** AIMZ squads wear the club crest; everyone else gets the opponent shield. */
  isAimz?: boolean;
};

/**
 * A team's crest. An uploaded logo still wins; otherwise the badge is drawn
 * from whether the team is ours.
 */
export function TeamAvatar({ name, logoUrl, size = 44, isAimz }: Props) {
  if (logoUrl) {
    return <Image accessibilityElementsHidden source={{ uri: logoUrl }} style={{ borderRadius: size / 2, height: size, width: size }} />;
  }
  return <TeamBadge isAimz={isAimz} name={name} size={size} />;
}
