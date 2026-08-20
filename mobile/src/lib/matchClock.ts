import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type { Match, MatchPhase } from '@/src/types/api';

type ClockMatch = Pick<Match, 'status' | 'phase' | 'phase_started_at'> & Partial<Pick<Match, 'half_length_minutes' | 'num_halves' | 'extra_time_half_length_minutes'>>;

function clockDurations(match: ClockMatch) {
  const regulationSeconds = (match.half_length_minutes ?? 45) * (match.num_halves ?? 2) * 60;
  return {
    halfSeconds: regulationSeconds / 2,
    regulationSeconds,
    extraTimeSeconds: (match.extra_time_half_length_minutes ?? 15) * 2 * 60,
  };
}

export type MatchClockState = {
  phase: MatchPhase;
  label: 'SCHEDULED' | 'LIVE' | 'HALFTIME' | 'EXTRA TIME' | 'FULL TIME';
  clockText: string | null;
  accessibilityLabel: string;
  minuteLabel: string | null;
  isRunning: boolean;
  isExtraTime: boolean;
  regulationProgress: number;
  extraTimeProgress: number;
};

export function resolveMatchPhase(match: Pick<ClockMatch, 'status' | 'phase'>): MatchPhase {
  if (match.phase) return match.phase;
  if (match.status === 'live') return 'first_half';
  if (match.status === 'finished') return 'finished';
  return 'not_started';
}

export function formatMatchClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function runningElapsedSeconds(match: ClockMatch, nowMs: number): number {
  if (!match.phase_started_at) return 0;
  const startedAt = Date.parse(match.phase_started_at);
  if (Number.isNaN(startedAt)) return 0;
  return Math.max(0, Math.floor((nowMs - startedAt) / 1000));
}

export function getMatchClockState(match: ClockMatch, nowMs = Date.now()): MatchClockState {
  const phase = resolveMatchPhase(match);
  const elapsed = runningElapsedSeconds(match, nowMs);
  const { halfSeconds, regulationSeconds, extraTimeSeconds } = clockDurations(match);
  if (match.status === 'scheduled' || phase === 'not_started') {
    return { phase: 'not_started', label: 'SCHEDULED', clockText: null, minuteLabel: null, accessibilityLabel: 'Scheduled', isRunning: false, isExtraTime: false, regulationProgress: 0, extraTimeProgress: 0 };
  }
  if (match.status === 'finished' || phase === 'finished') {
    return { phase: 'finished', label: 'FULL TIME', clockText: null, minuteLabel: 'FT', accessibilityLabel: 'Full time', isRunning: false, isExtraTime: false, regulationProgress: 1, extraTimeProgress: 0 };
  }
  if (phase === 'halftime') {
    return { phase, label: 'HALFTIME', clockText: null, minuteLabel: 'HT', accessibilityLabel: 'Halftime', isRunning: false, isExtraTime: false, regulationProgress: 0.5, extraTimeProgress: 0 };
  }
  if (phase === 'extra_time') {
    const total = regulationSeconds + elapsed;
    const clockText = formatMatchClock(total);
    return {
      phase,
      label: 'EXTRA TIME',
      clockText,
      minuteLabel: `${Math.floor(total / 60)}'`,
      accessibilityLabel: `Extra time, ${clockText}`,
      isRunning: true,
      isExtraTime: true,
      regulationProgress: 1,
      extraTimeProgress: Math.min(elapsed / extraTimeSeconds, 1),
    };
  }

  const isSecondHalf = phase === 'second_half';
  const total = (isSecondHalf ? halfSeconds : 0) + elapsed;
  const clockText = formatMatchClock(total);
  const regulationProgress = isSecondHalf
    ? 0.5 + Math.min(elapsed / halfSeconds, 1) * 0.5
    : Math.min(elapsed / halfSeconds, 1) * 0.5;
  return {
    phase,
    label: 'LIVE',
    clockText,
    minuteLabel: `${Math.floor(total / 60)}'`,
    accessibilityLabel: `Live, ${clockText}`,
    isRunning: true,
    isExtraTime: false,
    regulationProgress,
    extraTimeProgress: 0,
  };
}

export function useMatchClock(match?: ClockMatch): MatchClockState {
  const safeMatch: ClockMatch = match ?? { status: 'scheduled', phase: 'not_started', phase_started_at: null };
  const [nowMs, setNowMs] = useState(Date.now);
  const phase = resolveMatchPhase(safeMatch);
  const isRunning = safeMatch.status === 'live' && phase !== 'halftime' && Boolean(safeMatch.phase_started_at);

  useEffect(() => {
    setNowMs(Date.now());
    if (!isRunning) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowMs(Date.now());
    });
    return () => {
      clearInterval(timer);
      appState.remove();
    };
  }, [isRunning, safeMatch.phase_started_at, phase]);

  return getMatchClockState(safeMatch, nowMs);
}
