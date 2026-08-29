import type { PressableStateCallbackType } from 'react-native';

/**
 * What a `Pressable` tells its style callback, including hover.
 *
 * `hovered` is real on the web build but is not in React Native's own types,
 * which describe the native platforms. Declaring it here keeps the pointer
 * states honest without a cast at each call site; it is simply absent on a
 * touch screen, where the style it guards never applies.
 */
export type PressState = PressableStateCallbackType & { hovered?: boolean };
