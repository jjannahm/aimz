export const copy = {
  appName: 'AIMZ Egypt',
  academy: "Girls' football academy",
  offline: 'You appear to be offline. Check your connection and try again.',
  emptyMatches: 'No matches in this section yet.',
  emptyPlayers: 'No players match this filter yet.',
  teams: 'Teams',
  awards: 'Stats',
  emptyAwards: 'Season awards appear once a competition has a finished match.',
  emptySquad: (ageGroup: string) => `Admin-added ${ageGroup} players will appear here.`,
  emptyLeaders: 'Rankings build automatically once finished matches have player stats.',
  retry: 'Try again',
} as const;
