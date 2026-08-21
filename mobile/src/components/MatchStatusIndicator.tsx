import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { MatchClockState } from '@/src/lib/matchClock';

type StatusProps = {
  clock: MatchClockState;
  muted?: boolean;
};

export function LiveDot({ running = true, testID = 'live-dot' }: { running?: boolean; testID?: string }) {
  const styles = useThemedStyles(stylesheet);
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
  const styles = useThemedStyles(stylesheet);
  return (
    <View accessible accessibilityLabel={clock.accessibilityLabel} accessibilityRole="text" style={styles.row}>
      <Text style={[styles.label, muted && styles.muted]}>{clock.label}</Text>
      {clock.isRunning ? <LiveDot /> : null}
      {clock.clockText ? <Text style={[styles.clock, muted && styles.muted]}>{clock.clockText}</Text> : null}
    </View>
  );
}

export function MatchProgressRail({ clock }: { clock: MatchClockState }) {
  const styles = useThemedStyles(stylesheet);
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

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  label: { color: colors.liveText, fontSize: theme.type.caption, fontWeight: '900', letterSpacing: 0.6 },
  muted: { color: colors.textSecondary },
  clock: { color: colors.liveText, fontSize: theme.type.caption, fontVariant: ['tabular-nums'], fontWeight: '900', minWidth: 38 },
  dot: { backgroundColor: colors.live, borderRadius: 4, height: 7, width: 7 },
  rail: { backgroundColor: colors.progressTrack, flexDirection: 'row', height: 3, overflow: 'hidden' },
  progress: { backgroundColor: colors.live, height: 3 },
  regulationSegment: { backgroundColor: colors.live, borderRightColor: colors.background, borderRightWidth: 1, height: 3, width: '75%' },
  extraTrack: { backgroundColor: colors.progressTrack, height: 3, width: '25%' },
});
