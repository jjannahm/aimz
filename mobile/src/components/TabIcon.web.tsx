import type { ColorValue } from 'react-native';

export type TabIconName = 'manage' | 'matches' | 'players' | 'settings' | 'standings';

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
    <circle cx="12" cy="12" r="8.5" />
    <path d="m9.3 10.1 2.7-2 2.7 2-1 3.2h-3.4l-1-3.2Z" />
    <path d="m12 3.5 0 4.6M3.9 9.2l5.4.9M6.4 18.8l3.9-5.5M17.6 18.8l-3.9-5.5M20.1 9.2l-5.4.9" />
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

function SettingsIcon() {
  return <>
    <circle cx="12" cy="12" r="3.2" />
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
  </>;
}

const icons: Record<TabIconName, () => React.JSX.Element> = {
  matches: MatchesIcon,
  standings: StandingsIcon,
  players: PlayersIcon,
  manage: ManageIcon,
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
