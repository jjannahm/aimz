import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { AuthShell } from '@/src/components/AuthShell';
import { FormField } from '@/src/components/FormField';
import { ApiError } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

const schema = z.object({ name: z.string().min(2, 'Enter your full name.'), email: z.email('Enter a valid email.'), password: z.string().min(10, 'Use at least 10 characters.'), inviteCode: z.string().min(4, 'Enter your academy invite code.') });
type Values = z.infer<typeof schema>;

export default function RegisterScreen() {
  const styles = useThemedStyles(stylesheet);
  const { register } = useAuth();
  const { control, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', email: '', password: '', inviteCode: '' } });
  const submit = handleSubmit(async (values) => {
    try { await register(values.name, values.email, values.password, values.inviteCode); }
    catch (error) { setError('root', { message: error instanceof ApiError ? error.message : 'Could not create the account.' }); }
  });
  return <AuthShell title="Join your academy" subtitle="Player accounts require an invitation code from AIMZ.">
    <View style={styles.form}>
      {errors.root ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{errors.root.message}</Text> : null}
      <Controller control={control} name="name" render={({ field }) => <FormField autoComplete="name" error={errors.name?.message} label="Full name" onBlur={field.onBlur} onChangeText={field.onChange} value={field.value} />} />
      <Controller control={control} name="email" render={({ field }) => <FormField autoCapitalize="none" autoComplete="email" error={errors.email?.message} keyboardType="email-address" label="Email" onBlur={field.onBlur} onChangeText={field.onChange} value={field.value} />} />
      <Controller control={control} name="password" render={({ field }) => <FormField autoComplete="new-password" error={errors.password?.message} hint="At least 10 characters" label="Password" onBlur={field.onBlur} onChangeText={field.onChange} secureTextEntry value={field.value} />} />
      <Controller control={control} name="inviteCode" render={({ field }) => <FormField autoCapitalize="characters" error={errors.inviteCode?.message} label="Academy invite code" onBlur={field.onBlur} onChangeText={field.onChange} value={field.value} />} />
      <AppButton label="Create account" loading={isSubmitting} onPress={submit} />
    </View>
    <Text style={styles.footer}>Already registered? <Link href="/(auth)/login" style={styles.link}>Sign in</Link></Text>
  </AuthShell>;
}
const stylesheet = (colors: ThemeColors) => StyleSheet.create({ form: { gap: theme.spacing.md }, error: { backgroundColor: colors.errorSurface, borderRadius: theme.radius.sm, color: colors.errorText, padding: theme.spacing.md }, link: { color: colors.accentSoft, fontWeight: '800' }, footer: { color: colors.textSecondary, textAlign: 'center' } });
