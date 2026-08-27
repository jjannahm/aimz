import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { AuditTrail } from '@/src/components/AuditTrail';
import { ChoiceField } from '@/src/components/ChoiceField';
import { CloseButton } from '@/src/components/CloseButton';
import { CollapsibleCard } from '@/src/components/CollapsibleCard';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import { ApiError, api } from '@/src/lib/api';
import { sessionStore } from '@/src/lib/session';
import { theme, type ThemeColors, type ThemePreference } from '@/src/theme';
import { useAppTheme, useThemedStyles } from '@/src/theme/ThemeProvider';

const themeOptions = [{ label: 'Match system', value: 'system' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }];

const profileSchema = z.object({ name: z.string().min(2, 'Enter your name.') });
const passwordSchema = z.object({ current: z.string().min(1, 'Enter your current password.'), next: z.string().min(10, 'Use at least 10 characters.') });

export default function SettingsScreen() {
  const styles = useThemedStyles(stylesheet);
  const { user, signOut } = useAuth();
  const { mode, preference, setPreference } = useAppTheme();
  const queryClient = useQueryClient();
  const profile = useForm({ resolver: zodResolver(profileSchema), defaultValues: { name: user?.name ?? '' } });
  const password = useForm({ resolver: zodResolver(passwordSchema), defaultValues: { current: '', next: '' } });
  const saveProfile = profile.handleSubmit(async ({ name }) => { try { await api.updateMe(name); const session = sessionStore.get(); if (session) await sessionStore.save({ ...session, user: { ...session.user, name } }); } catch (error) { profile.setError('root', { message: (error as ApiError).message }); } });
  const savePassword = password.handleSubmit(async ({ current, next }) => { try { await api.changePassword(current, next); password.reset(); await signOut(); queryClient.clear(); router.replace('/(auth)/login'); Alert.alert('Password updated', 'For security, sign in again with your new password.'); } catch (error) { password.setError('root', { message: (error as ApiError).message }); } });
  const confirmDelete = () => Alert.alert('Delete your account?', 'Your login and sessions will be permanently removed. Historical team statistics are preserved.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: async () => { try { await api.deleteMe(); await sessionStore.clear(); queryClient.clear(); router.replace('/(auth)/login'); } catch (error) { Alert.alert('Could not delete account', (error as ApiError).message); } } }]);
  const closeSettings = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(app)/(tabs)');
  };
  return <Screen action={<CloseButton onPress={closeSettings} />} hideSettings title="Settings">
    <View style={styles.card}><Text style={styles.heading}>Profile</Text><Text style={styles.meta}>{user?.email}</Text>{profile.formState.errors.root ? <Text style={styles.error}>{profile.formState.errors.root.message}</Text> : null}<Controller control={profile.control} name="name" render={({ field }) => <FormField error={profile.formState.errors.name?.message} label="Name" onChangeText={field.onChange} value={field.value} />} /><AppButton label="Save profile" loading={profile.formState.isSubmitting} onPress={saveProfile} /></View>
    <View style={styles.card}><Text style={styles.heading}>Appearance</Text><ChoiceField label="Theme" onChange={(value) => setPreference(value as ThemePreference)} options={themeOptions} value={preference} /><Text style={styles.meta}>{preference === 'system' ? `Following your device, currently ${mode}.` : 'Set for this app only.'}</Text></View>
    {user?.role === 'admin' ? <CollapsibleCard summary="Every change an admin made to a match." title="Admin activity"><AuditTrail limit={20} /><AppButton label="See the full log" onPress={() => router.push('/audit')} variant="secondary" /></CollapsibleCard> : null}
    <CollapsibleCard onCollapse={() => password.reset()} summary="Update your sign-in password." title="Change password">{password.formState.errors.root ? <Text style={styles.error}>{password.formState.errors.root.message}</Text> : null}<Controller control={password.control} name="current" render={({ field }) => <FormField autoComplete="current-password" error={password.formState.errors.current?.message} label="Current password" onChangeText={field.onChange} secureTextEntry value={field.value} />} /><Controller control={password.control} name="next" render={({ field }) => <FormField autoComplete="new-password" error={password.formState.errors.next?.message} label="New password" onChangeText={field.onChange} secureTextEntry value={field.value} />} /><AppButton label="Update password" loading={password.formState.isSubmitting} onPress={savePassword} variant="secondary" /></CollapsibleCard>
    <View style={styles.card}><Text style={styles.heading}>Session</Text><AppButton label="Sign out" onPress={() => signOut()} variant="secondary" /><AppButton label="Delete account" onPress={confirmDelete} variant="danger" /></View>
  </Screen>;
}
const stylesheet = (colors: ThemeColors) => StyleSheet.create({ card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.lg }, heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, meta: { color: colors.textMuted }, error: { color: colors.errorText } });
