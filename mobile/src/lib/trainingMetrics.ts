import type { Player, TrainingMetric } from '@/src/types/api';

/** Goalkeeper forms are selected from the roster position, never by hand. */
export const isGoalkeeper = (player: Pick<Player, 'position'>) => player.position?.trim().toUpperCase() === 'GK';

/** The active metric set that applies to one player's existing position. */
const metricAppliesToPlayer = (metric: TrainingMetric, player: Pick<Player, 'position'>) => {
  const kind = isGoalkeeper(player) ? 'goalkeeper' : 'outfield';
  // Missing means an older cached response from before metrics became
  // position-aware; those metrics were shared by every player.
  return !metric.player_kind || metric.player_kind === 'all' || metric.player_kind === kind;
};

export const metricsForPlayer = (metrics: TrainingMetric[], player: Pick<Player, 'position'>) =>
  metrics.filter((metric) => metricAppliesToPlayer(metric, player));
