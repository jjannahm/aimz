import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { registerDialogHost, type DialogRequest } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * The app's own confirmation and message dialog. Mounted once at the root so
 * web stops raising the browser's native confirm()/alert() chrome, which
 * ignored the dark theme entirely.
 */
export function DialogHost() {
  const styles = useThemedStyles(stylesheet);
  const [request, setRequest] = useState<DialogRequest | null>(null);

  useEffect(() => registerDialogHost(setRequest), []);

  const dismiss = () => setRequest(null);
  const accept = () => {
    // Close first: the action may navigate away from this screen.
    setRequest(null);
    request?.onConfirm?.();
  };

  if (!request) return null;
  const isConfirm = Boolean(request.confirmLabel);

  return (
    <Modal animationType="fade" onRequestClose={dismiss} transparent visible>
      <View style={styles.backdrop}>
        {/* A sibling rather than a parent: wrapping the card would nest the
            action buttons inside this one, which is invalid HTML on web. */}
        <Pressable
          accessibilityLabel="Dismiss dialog"
          accessibilityRole="button"
          onPress={dismiss}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityRole="alert" style={styles.card}>
          <Text style={styles.title}>{request.title}</Text>
          {request.message ? <Text style={styles.message}>{request.message}</Text> : null}
          <View style={styles.actions}>
            {isConfirm ? <AppButton label="Cancel" onPress={dismiss} style={styles.action} variant="ghost" /> : null}
            <AppButton
              label={request.confirmLabel ?? 'OK'}
              onPress={accept}
              style={styles.action}
              variant={request.destructive ? 'danger' : 'primary'}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { alignItems: 'center', backgroundColor: 'rgba(4, 8, 26, 0.72)', flex: 1, justifyContent: 'center', padding: theme.spacing.lg },
  card: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.md, maxWidth: 420, padding: theme.spacing.lg, width: '100%' },
  title: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' },
  message: { color: colors.textSecondary, fontSize: theme.type.body, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'flex-end' },
  action: { minWidth: 96 },
});
