import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the reader has asked the system for less movement.
 *
 * Shared rather than repeated because every animated component here has to
 * consult it before it starts anything.
 */
export function useReduceMotion() {
  // Start conservatively so a selection made before the async preference read
  // never flashes an animation at somebody who has asked not to see one.
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

  return reduceMotion;
}
