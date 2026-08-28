import type { ColorValue } from 'react-native';

export type TabIconName = 'manage' | 'matches' | 'myTeam' | 'players' | 'settings' | 'standings';

type Props = {
  color: ColorValue;
  name: TabIconName;
  size: number;
};

const common = {
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.9,
};

function MatchesIcon() {
  return <>
    <rect height="15" rx="1.5" width="20" x="2" y="4.5" />
    <path d="M12 4.5v15" />
    <circle cx="12" cy="12" r="2.8" />
    <path d="M2 8.8h2.8v6.4H2M22 8.8h-2.8v6.4H22" />
  </>;
}

function StandingsIcon() {
  return <>
    <path d="M4 20h16" />
    <path d="M5.5 20v-6h4v6M10 20V7h4v13M14.5 20v-9h4v9" />
  </>;
}

function PlayersIcon() {
  return <>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.8 19c.4-3.5 2.2-5.3 5.2-5.3s4.8 1.8 5.2 5.3" />
    <circle cx="17" cy="9" r="2.4" />
    <path d="M15.1 14.2c3.3-.8 5.2.8 5.5 3.8" />
  </>;
}

function ManageIcon() {
  return <>
    <path d="M5 19h3.2L19 8.2 15.8 5 5 15.8V19Z" />
    <path d="m13.8 7 3.2 3.2M5 15.8 8.2 19" />
  </>;
}

function MyTeamIcon() {
  return <><rect height="17" rx="2" width="18" x="3" y="4" /><path d="M7 2v4M17 2v4M3 9h18M7 13h3M14 13h3M7 17h3" /></>;
}

function SettingsIcon() {
  return <>
    <path d="M18.2 10.2L21.2 10.5L21.2 13.5L18.2 13.8L17.7 15.2L19.6 17.4L17.4 19.6L15.2 17.7L13.8 18.2L13.5 21.2L10.5 21.2L10.2 18.2L8.8 17.7L6.6 19.6L4.4 17.4L6.3 15.2L5.8 13.8L2.8 13.5L2.8 10.5L5.8 10.2L6.3 8.8L4.4 6.6L6.6 4.4L8.8 6.3L10.2 5.8L10.5 2.8L13.5 2.8L13.8 5.8L15.2 6.3L17.4 4.4L19.6 6.6L17.7 8.8Z" />
    <circle cx="12" cy="12" r="3.2" />
  </>;
}

const icons: Record<TabIconName, () => React.JSX.Element> = {
  matches: MatchesIcon,
  standings: StandingsIcon,
  players: PlayersIcon,
  manage: ManageIcon,
  myTeam: MyTeamIcon,
  settings: SettingsIcon,
};

export function TabIcon({ color, name, size }: Props) {
  const Icon = icons[name];
  return <svg
    aria-hidden="true"
    focusable="false"
    height={size}
    style={{ color: String(color), display: 'block' }}
    viewBox="0 0 24 24"
    width={size}
    {...common}
    stroke="currentColor"
  >
    <Icon />
  </svg>;
}
