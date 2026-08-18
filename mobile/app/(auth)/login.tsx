import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { AuthShell } from '@/src/components/AuthShell';
import { FormField } from '@/src/components/FormField';
import { appConfig } from '@/src/config';
import { ApiError } from '@/src/lib/api';
import { theme } from '@/src/theme';

const schema = z.object({ email: z.email('Enter a valid email.'), password: z.string().min(1, 'Enter your password.') });
type Values = z.infer<typeof schema>;

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { control, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  const submit = handleSubmit(async (values) => {
    try { await signIn(values.email, values.password); }
    catch (error) { setError('root', { message: error instanceof ApiError ? error.message : 'Could not sign in.' }); }
  });
  return <AuthShell title="Welcome back" subtitle="Follow every AIMZ match, table and player performance.">
    <View style={styles.form}>
      {errors.root ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{errors.root.message}</Text> : null}
      <Controller control={control} name="email" render={({ field }) => <FormField autoCapitalize="none" autoComplete="email" error={errors.email?.message} keyboardType="email-address" label="Email" onBlur={field.onBlur} onChangeText={field.onChange} value={field.value} />} />
      <Controller control={control} name="password" render={({ field }) => <FormField autoComplete="current-password" error={errors.password?.message} label="Password" onBlur={field.onBlur} onChangeText={field.onChange} secureTextEntry value={field.value} />} />
      {appConfig.enablePasswordReset
        ? <Link href="/(auth)/reset-password" style={styles.link}>Forgot password?</Link>
        : <Text style={styles.disabledNote}>Password reset is unavailable in this staging preview.</Text>}
      <AppButton label="Sign in" loading={isSubmitting} onPress={submit} />
    </View>
    <Text style={styles.footer}>New to AIMZ? <Link href="/(auth)/register" style={styles.link}>Create a player account</Link></Text>
  </AuthShell>;
}

const styles = StyleSheet.create({ form: { gap: theme.spacing.md }, error: { backgroundColor: theme.colors.errorSurface, borderRadius: theme.radius.sm, color: theme.colors.errorText, padding: theme.spacing.md }, link: { color: theme.colors.lightBlue, fontWeight: '800', minHeight: theme.touch.minimum, paddingVertical: 12 }, disabledNote: { color: theme.colors.textMuted, fontSize: theme.type.label, lineHeight: 20 }, footer: { color: theme.colors.textSecondary, textAlign: 'center' } });
