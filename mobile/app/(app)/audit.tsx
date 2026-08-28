import { Redirect, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/src/auth/AuthProvider';
import { AuditTrail } from '@/src/components/AuditTrail';
import { CloseButton } from '@/src/components/CloseButton';
import { Screen } from '@/src/components/Screen';

export default function AuditLogScreen() {
  const { user } = useAuth();
  // Reachable per match as well as whole-academy, so a disputed match can be
  // read on its own. Settings is the only place that links here.
  const { matchId } = useLocalSearchParams<{ matchId?: string }>();
  if (user?.role !== 'admin') return <Redirect href="/(app)/(tabs)" />;
  return <Screen action={<CloseButton />} title="Admin activity">
    <AuditTrail matchId={matchId} />
  </Screen>;
}
