import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { theme } from '@/src/theme';
import type { MatchClockState } from '@/src/lib/matchClock';

type StatusProps = {
  clock: MatchClockState;
  muted?: boolean;
};

export function LiveDot({ running = true, testID = 'live-dot' }: { running?: boolean; testID?: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    opacity.stopAnimation();
    opacity.setValue(1);
    if (!running || reduceMotion) return undefined;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { duration: 500, easing: Easing.inOut(Easing.ease), toValue: 0.3, useNativeDriver: true }),
        Animated.timing(opacity, { duration: 500, easing: Easing.inOut(Easing.ease), toValue: 1, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion, running]);

  return <Animated.View accessible={false} style={[styles.dot, { opacity }]} testID={testID} />;
}

export function MatchStatusIndicator({ clock, muted = false }: StatusProps) {
  return (
    <View accessible accessibilityLabel={clock.accessibilityLabel} accessibilityRole="text" style={styles.row}>
      <Text style={[styles.label, muted && styles.muted]}>{clock.label}</Text>
      {clock.isRunning ? <LiveDot /> : null}
      {clock.clockText ? <Text style={[styles.clock, muted && styles.muted]}>{clock.clockText}</Text> : null}
    </View>
  );
}

export function MatchProgressRail({ clock }: { clock: MatchClockState }) {
  if (clock.phase === 'not_started' || clock.phase === 'finished') return null;
  if (clock.isExtraTime) {
    return (
      <View style={styles.rail}>
        <View style={styles.regulationSegment} />
        <View style={styles.extraTrack}>
          <View style={[styles.progress, { width: `${clock.extraTimeProgress * 100}%` }]} testID="extra-time-progress" />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.rail}>
      <View style={[styles.progress, { width: `${clock.regulationProgress * 100}%` }]} testID="regulation-progress" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  label: { color: theme.colors.liveText, fontSize: theme.type.caption, fontWeight: '900', letterSpacing: 0.6 },
  muted: { color: theme.colors.textSecondary },
  clock: { color: theme.colors.liveText, fontSize: theme.type.caption, fontVariant: ['tabular-nums'], fontWeight: '900', minWidth: 38 },
  dot: { backgroundColor: theme.colors.live, borderRadius: 4, height: 7, width: 7 },
  rail: { backgroundColor: theme.colors.progressTrack, flexDirection: 'row', height: 3, overflow: 'hidden' },
  progress: { backgroundColor: theme.colors.live, height: 3 },
  regulationSegment: { backgroundColor: theme.colors.live, borderRightColor: theme.colors.background, borderRightWidth: 1, height: 3, width: '75%' },
  extraTrack: { backgroundColor: theme.colors.progressTrack, height: 3, width: '25%' },
});
