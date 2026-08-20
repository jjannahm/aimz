import { Alert, Platform } from 'react-native';

type WebDialogGlobals = typeof globalThis & {
  alert?: (message?: string) => void;
  confirm?: (message?: string) => boolean;
};

const webDialogs = globalThis as WebDialogGlobals;

export function showMessage(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    webDialogs.alert?.(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
): void {
  if (Platform.OS === 'web') {
    if (webDialogs.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, onPress: onConfirm },
  ]);
}
