import { Alert, Platform } from 'react-native';

type WebDialogGlobals = typeof globalThis & {
  alert?: (message?: string) => void;
  confirm?: (message?: string) => boolean;
};

const webDialogs = globalThis as WebDialogGlobals;

export type DialogRequest = {
  title: string;
  message?: string;
  /** Absent for a message-only dialog, which just needs dismissing. */
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
};

type Present = (request: DialogRequest) => void;

let present: Present | null = null;

/**
 * DialogHost claims this slot while mounted. Everything else keeps calling
 * confirmAction/showMessage and gets the themed dialog for free.
 */
export function registerDialogHost(next: Present): () => void {
  present = next;
  return () => {
    if (present === next) present = null;
  };
}

type Announce = (message: string) => void;

let announce: Announce | null = null;

/**
 * ToastHost claims this slot while mounted, the way DialogHost claims the
 * dialog one.
 */
export function registerToastHost(next: Announce): () => void {
  announce = next;
  return () => {
    if (announce === next) announce = null;
  };
}

/**
 * Says something went right, without asking to be dismissed.
 *
 * A dialog is the wrong shape for good news: it stops the admin to tell them
 * nothing went wrong, and it cannot survive the navigation that usually
 * follows. With no host mounted this stays silent — a success nobody sees is
 * better than a modal nobody asked for.
 */
export function showToast(message: string): void {
  announce?.(message);
}

export function showMessage(title: string, message?: string): void {
  if (present) {
    present({ title, message });
    return;
  }
  // No host mounted — a screen rendered in isolation still gets told.
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
  options?: { destructive?: boolean },
): void {
  if (present) {
    present({ title, message, confirmLabel, destructive: options?.destructive, onConfirm });
    return;
  }
  if (Platform.OS === 'web') {
    if (webDialogs.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, onPress: onConfirm, style: options?.destructive ? 'destructive' : 'default' },
  ]);
}
