import React from 'react';
import { AppState, Image, Platform, StyleSheet, View, type AppStateStatus } from 'react-native';

import { useAppTheme } from '@/src/theme/ThemeProvider';

/**
 * Covers the app while it is not in the foreground.
 *
 * iOS and Android photograph the current screen when the app is backgrounded,
 * to animate the app switcher, and that photograph is written to disk. On a
 * squad list that is harmless; on a player's personal details, their emergency
 * contacts or a family's fee ledger it is a copy of a child's record sitting
 * outside the Keychain, readable by anyone who later gets the device. MASVS
 * calls this out (MASVS-STORAGE-2), and reviewers for apps handling children's
 * data increasingly look for it.
 *
 * `inactive` matters as much as `background`: iOS passes through it while the
 * switcher snapshot is being taken, and on Android it is what covers the
 * screen during the recents animation. Anything other than `active` is covered.
 *
 * Web is exempt — a browser takes no such snapshot, and there is no app
 * switcher to hide from.
 */
export function PrivacyScreen() {
  const { colors } = useAppTheme();
  const [hidden, setHidden] = React.useState(false);

  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      setHidden(next !== 'active');
    });
    return () => { subscription.remove(); };
  }, []);

  if (Platform.OS === 'web' || !hidden) return null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: colors.background }]}
      testID="privacy-screen"
    >
      <Image
        accessibilityIgnoresInvertColors
        resizeMode="contain"
        source={require('../../assets/branding/splash-icon.png')}
        style={styles.mark}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  mark: { height: 96, opacity: 0.9, width: 96 },
});
