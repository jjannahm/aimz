import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { AppButton } from '@/src/components/AppButton';
import { AuthShell } from '@/src/components/AuthShell';
import { FormField } from '@/src/components/FormField';
import { ApiError, api } from '@/src/lib/api';
import { theme } from '@/src/theme';

const schema = z.object({ email: z.email('Enter a valid email.'), code: z.string().regex(/^\s?\d{6}$/, 'Enter the six-digit code.'), password: z.string().min(10, 'Use at least 10 characters.') });
type Values = z.infer<typeof schema>;

export default function ResetPasswordScreen() {
  const { control, watch, handleSubmit, setError, setValue, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', code: '', password: '' } });
  const code = watch('code');
  const requestCode = async () => {
    const email = watch('email');
    if (!z.email().safeParse(email).success) { setError('email', { message: 'Enter a valid email.' }); return; }
    try { await api.requestReset(email); setValue('code', ' '); }
    catch (error) { setError('root', { message: error instanceof ApiError ? error.message : 'Could not request a code.' }); }
  };
  const submit = handleSubmit(async (values) => {
    try { await api.confirmReset(values.email, values.code.trim(), values.password); setValue('code', ''); }
    catch (error) { setError('root', { message: error instanceof ApiError ? error.message : 'Could not reset password.' }); }
  });
  const codeRequested = code.length > 0;
  return <AuthShell title="Reset password" subtitle="We will email a six-digit code if the account exists.">
    <View style={styles.form}>
      {errors.root ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{errors.root.message}</Text> : null}
      <Controller control={control} name="email" render={({ field }) => <FormField autoCapitalize="none" autoComplete="email" error={errors.email?.message} keyboardType="email-address" label="Email" onChangeText={field.onChange} value={field.value} />} />
      {codeRequested ? <><Controller control={control} name="code" render={({ field }) => <FormField error={errors.code?.message} keyboardType="number-pad" label="Reset code" maxLength={6} onChangeText={field.onChange} value={field.value.trim()} />} /><Controller control={control} name="password" render={({ field }) => <FormField autoComplete="new-password" error={errors.password?.message} label="New password" onChangeText={field.onChange} secureTextEntry value={field.value} />} /><AppButton label="Set new password" loading={isSubmitting} onPress={submit} /></> : <AppButton label="Email reset code" onPress={requestCode} />}
    </View>
    <Link href="/(auth)/login" style={styles.link}>Back to sign in</Link>
  </AuthShell>;
}
const styles = StyleSheet.create({ form: { gap: theme.spacing.md }, error: { color: theme.colors.errorText }, link: { color: theme.colors.lightBlue, fontWeight: '800', textAlign: 'center' } });
