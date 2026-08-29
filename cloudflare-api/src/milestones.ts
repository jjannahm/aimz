// Kept free of runtime imports so it can be unit tested the way scoring-rules
// and match-clock are.

/** One match's record, oldest first, which is the order everything here reads. */
export interface MilestoneMatch {
  match_id: string;
  kickoff_datetime: string;
  appeared: boolean;
  goals: number;
  assists: number;
  /** Whether this player was named man of the match. */
  motm: boolean;
}

export interface Milestone {
  /** Stable enough to key a list on, and to recognise across two responses. */
  id: string;
  label: string;
  /** When it was reached. */
  kickoff_datetime: string;
  match_id: string;
}

export interface Streak {
  id: string;
  label: string;
  count: number;
}

/** What the player is closest to next, and how far away it is. */
export interface NextMilestone {
  id: string;
  label: string;
  current: number;
  target: number;
  remaining: number;
}

export interface MilestoneSummary {
  reached: Milestone[];
  streaks: Streak[];
  next: NextMilestone[];
}

const APPEARANCE_MARKS = [10, 25, 50, 100] as const;
const GOAL_MARKS = [5, 10, 25, 50] as const;
const MOTM_MARKS = [5, 10, 25] as const;

/** A hat-trick is three in one match, and four or more is still a hat-trick plus. */
const HAT_TRICK = 3;

const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;

/**
 * Everything a player has reached, is on a run of, and is closest to next.
 *
 * `matches` must be oldest first: every count here accumulates forward, and the
 * streaks read backwards from the end.
 */
export function summariseMilestones(matches: MilestoneMatch[]): MilestoneSummary {
  const reached: Milestone[] = [];
  let appearances = 0;
  let goals = 0;
  let assists = 0;
  let motm = 0;

  for (const match of matches) {
    const at = { kickoff_datetime: match.kickoff_datetime, match_id: match.match_id };
    if (match.appeared) {
      appearances += 1;
      if (appearances === 1) reached.push({ id: "first-appearance", label: "First appearance", ...at });
      for (const mark of APPEARANCE_MARKS) {
        if (appearances === mark) reached.push({ id: `appearances-${mark}`, label: `${mark} appearances`, ...at });
      }
    }
    if (match.goals > 0) {
      const before = goals;
      goals += match.goals;
      if (before === 0) reached.push({ id: "first-goal", label: "First goal", ...at });
      // A brace can cross a mark without landing on it, so this is a crossing
      // test rather than an equality one.
      for (const mark of GOAL_MARKS) {
        if (before < mark && goals >= mark) reached.push({ id: `goals-${mark}`, label: `${mark} goals`, ...at });
      }
      if (match.goals >= HAT_TRICK) {
        reached.push({ id: `hat-trick-${match.match_id}`, label: match.goals > HAT_TRICK ? `${match.goals} goals in a match` : "Hat-trick", ...at });
      }
    }
    if (match.assists > 0) {
      if (assists === 0) reached.push({ id: "first-assist", label: "First assist", ...at });
      assists += match.assists;
    }
    if (match.motm) {
      motm += 1;
      if (motm === 1) reached.push({ id: "first-motm", label: "First man of the match", ...at });
      for (const mark of MOTM_MARKS) {
        if (motm === mark) reached.push({ id: `motm-${mark}`, label: `${mark} man of the match awards`, ...at });
      }
    }
  }

  return { reached: reached.reverse(), streaks: currentStreaks(matches), next: nextMilestones({ appearances, goals, motm }) };
}

/**
 * Runs that are still alive, counted back from the most recent match.
 *
 * Only matches the player appeared in count towards a scoring run: being left
 * out does not end a run the way a goalless match does.
 */
function currentStreaks(matches: MilestoneMatch[]): Streak[] {
  const streaks: Streak[] = [];
  const played = matches.filter((match) => match.appeared);

  let scoring = 0;
  for (let index = played.length - 1; index >= 0; index -= 1) {
    if (played[index]!.goals > 0) scoring += 1;
    else break;
  }
  // Two is the shortest run worth calling a run, so this is always plural.
  if (scoring >= 2) streaks.push({ id: "scoring-streak", label: `Scored in ${scoring} consecutive matches`, count: scoring });

  let consecutive = 0;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    if (matches[index]!.appeared) consecutive += 1;
    else break;
  }
  if (consecutive >= 3) streaks.push({ id: "appearance-streak", label: `${consecutive} consecutive appearances`, count: consecutive });

  return streaks;
}

/**
 * The next mark on each track the player is already on.
 *
 * This is the part that motivates — "2 more appearances to 50" is a reason to
 * turn up — so a track the player has not started yet is left out rather than
 * offering a 14-year-old a hundred appearances she is nowhere near.
 */
function nextMilestones(totals: { appearances: number; goals: number; motm: number }): NextMilestone[] {
  const next: NextMilestone[] = [];
  const track = (id: string, noun: string, one: string, current: number, marks: readonly number[]) => {
    const target = marks.find((mark) => mark > current);
    if (target === undefined) return;
    const remaining = target - current;
    next.push({ id, label: `${remaining} more ${remaining === 1 ? one : noun} to ${target}`, current, target, remaining });
  };
  if (totals.appearances > 0) track("next-appearances", "appearances", "appearance", totals.appearances, APPEARANCE_MARKS);
  if (totals.goals > 0) track("next-goals", "goals", "goal", totals.goals, GOAL_MARKS);
  if (totals.motm > 0) track("next-motm", "awards", "award", totals.motm, MOTM_MARKS);
  return next;
}
