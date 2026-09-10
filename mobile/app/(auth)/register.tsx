import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { AuthShell } from '@/src/components/AuthShell';
import { ChoiceField } from '@/src/components/ChoiceField';
import { FormField } from '@/src/components/FormField';
import { ApiError, api } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { InviteContext, NewcomerApplicationPayload } from '@/src/types/api';

type Values = Omit<NewcomerApplicationPayload, 'full_name' | 'email' | 'consent'> & {
  inviteCode: string; name: string; email: string; password: string; consent: boolean;
};
const empty: Values = { inviteCode: '', name: '', email: '', password: '', branch: '', mobile: '', whatsapp_mobile: '', date_of_birth: '', nationality: '', address: '', previous_academy: '', school_university: '', father_name: '', father_mobile: '', mother_name: '', mother_mobile: '', medical_concerns: '', medications: '', consent: false };
const branches = ['AUC (East)', 'Gardenia (Agyal Park) (East)', 'Palm Hills Sporting Club (West)', "King’s School The Crown (West)"];
const playerSteps = ['Invitation', 'Account', 'Player', 'Family', 'Health'];

export default function RegisterScreen() {
  const styles = useThemedStyles(stylesheet);
  const params = useLocalSearchParams<{ code?: string }>();
  const { register } = useAuth();
  const [values, setValues] = useState<Values>({ ...empty, inviteCode: params.code ?? '' });
  const [errors, setErrors] = useState<Partial<Record<keyof Values | 'root', string>>>({});
  const [invite, setInvite] = useState<InviteContext | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const needsApplication = invite?.kind === 'player' && invite.requires_application;
  const steps = useMemo(() => needsApplication ? playerSteps : ['Invitation', 'Account'], [needsApplication]);
  const set = (field: keyof Values, value: string | boolean) => setValues((current) => ({ ...current, [field]: value }));

  const checkFields = (fields: (keyof Values)[]) => {
    const next: typeof errors = {};
    for (const field of fields) {
      const value = values[field];
      if (value === false || String(value).trim().length < (field === 'password' ? 10 : 2)) next[field] = field === 'consent' ? 'Consent is required.' : 'This field is required. Enter None if it does not apply.';
    }
    if (fields.includes('email') && !/^\S+@\S+\.\S+$/.test(values.email)) next.email = 'Enter a valid email.';
    if (fields.includes('date_of_birth') && !/^\d{4}-\d{2}-\d{2}$/.test(values.date_of_birth)) next.date_of_birth = 'Use YYYY-MM-DD.';
    setErrors(next);
    return !Object.keys(next).length;
  };
  const resolve = async () => {
    if (!checkFields(['inviteCode'])) return;
    setBusy(true);
    try { setInvite(await api.resolveInvite(values.inviteCode)); setStep(1); }
    catch (error) { setErrors({ root: error instanceof ApiError ? error.message : 'Could not check this invitation.' }); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (params.code) void resolve(); }, []);
  const next = () => {
    const fields: (keyof Values)[][] = [[], ['name', 'email', 'password'], ['branch', 'mobile', 'whatsapp_mobile', 'date_of_birth', 'nationality', 'address', 'previous_academy', 'school_university'], ['father_name', 'father_mobile', 'mother_name', 'mother_mobile'], ['medical_concerns', 'medications', 'consent']];
    if (checkFields(fields[step] ?? [])) setStep((current) => current + 1);
  };
  const submit = async () => {
    const finalFields: (keyof Values)[] = needsApplication ? ['medical_concerns', 'medications', 'consent'] : ['name', 'email', 'password'];
    if (!checkFields(finalFields)) return;
    setBusy(true);
    try {
      const application: NewcomerApplicationPayload | undefined = needsApplication ? {
        branch: values.branch, full_name: values.name, mobile: values.mobile, email: values.email,
        whatsapp_mobile: values.whatsapp_mobile, date_of_birth: values.date_of_birth,
        nationality: values.nationality, address: values.address, previous_academy: values.previous_academy,
        school_university: values.school_university, father_name: values.father_name,
        father_mobile: values.father_mobile, mother_name: values.mother_name,
        mother_mobile: values.mother_mobile, medical_concerns: values.medical_concerns,
        medications: values.medications, consent: true,
      } : undefined;
      await register(values.name, values.email, values.password, values.inviteCode, application);
    } catch (error) { setErrors({ root: error instanceof ApiError ? error.message : 'Could not create the account.' }); }
    finally { setBusy(false); }
  };
  return <AuthShell title={invite ? `Join as ${invite.kind}` : 'Join AIMZ'} subtitle={invite?.team_name ? `${invite.label} · ${invite.team_name}` : 'Use the invitation AIMZ sent you.'}>
    <View style={styles.progress} accessibilityLabel={`Step ${step + 1} of ${steps.length}: ${steps[step]}`}>{steps.map((label, index) => <View key={label} style={styles.progressItem}><View style={[styles.dot, index <= step && styles.dotActive]} /><Text style={styles.progressLabel}>{label}</Text></View>)}</View>
    <View style={styles.form}>
      {errors.root ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{errors.root}</Text> : null}
      {step === 0 ? <><Input field="inviteCode" label="Academy invite code" values={values} errors={errors} set={set} editable={!params.code} /><AppButton label="Continue" loading={busy} onPress={() => void resolve()} /></> : null}
      {step === 1 ? <><Input field="name" label="Full name" values={values} errors={errors} set={set} /><Input field="email" label="Email" values={values} errors={errors} set={set} keyboardType="email-address" autoCapitalize="none" /><Input field="password" label="Password" hint="At least 10 characters" values={values} errors={errors} set={set} secureTextEntry /></> : null}
      {step === 2 ? <><ChoiceField error={errors.branch} label="Branch" onChange={(value) => set('branch', value)} options={branches.map((value) => ({ label: value, value }))} placeholder="Choose a branch" value={values.branch} /><Input field="mobile" label="Mobile" values={values} errors={errors} set={set} keyboardType="phone-pad" /><Input field="whatsapp_mobile" label="WhatsApp mobile" values={values} errors={errors} set={set} keyboardType="phone-pad" /><Input field="date_of_birth" label="Date of birth" hint="YYYY-MM-DD" values={values} errors={errors} set={set} /><Input field="nationality" label="Nationality" values={values} errors={errors} set={set} /><Input field="address" label="Address" values={values} errors={errors} set={set} /><Input field="previous_academy" label="Previous club or academy" hint="Enter None if not applicable" values={values} errors={errors} set={set} /><Input field="school_university" label="School or university" values={values} errors={errors} set={set} /></> : null}
      {step === 3 ? <><Input field="father_name" label="Father’s name" values={values} errors={errors} set={set} /><Input field="father_mobile" label="Father’s mobile" values={values} errors={errors} set={set} keyboardType="phone-pad" /><Input field="mother_name" label="Mother’s name" values={values} errors={errors} set={set} /><Input field="mother_mobile" label="Mother’s mobile" values={values} errors={errors} set={set} keyboardType="phone-pad" /></> : null}
      {step === 4 ? <><Input field="medical_concerns" label="Medical concerns" hint="Enter None if there are none" values={values} errors={errors} set={set} multiline /><Input field="medications" label="Medications" hint="Enter None if there are none" values={values} errors={errors} set={set} multiline /><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: values.consent }} onPress={() => set('consent', !values.consent)} style={styles.consent}><View style={[styles.checkbox, values.consent && styles.checkboxChecked]} /><Text style={styles.consentText}>I consent to AIMZ storing and using this information to contact me and process this application.</Text></Pressable>{errors.consent ? <Text style={styles.error}>{errors.consent}</Text> : null}</> : null}
      {step > 0 ? <View style={styles.actions}><AppButton label="Back" onPress={() => setStep((current) => current - 1)} variant="ghost" />{step === steps.length - 1 ? <AppButton label="Create account" loading={busy} onPress={() => void submit()} /> : <AppButton label="Continue" onPress={next} />}</View> : null}
    </View>
    <Text style={styles.footer}>Already registered? <Link href="/(auth)/login" style={styles.link}>Sign in</Link></Text>
  </AuthShell>;
}

function Input({ field, label, values, errors, set, ...props }: { field: keyof Values; label: string; values: Values; errors: Partial<Record<keyof Values | 'root', string>>; set: (field: keyof Values, value: string | boolean) => void; [key: string]: unknown }) {
  return <FormField {...props} error={errors[field]} label={label} onChangeText={(value) => set(field, value)} value={String(values[field] ?? '')} />;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ form: { gap: theme.spacing.md }, error: { backgroundColor: colors.errorSurface, borderRadius: theme.radius.sm, color: colors.errorText, padding: theme.spacing.md }, progress: { flexDirection: 'row', gap: theme.spacing.xs }, progressItem: { alignItems: 'center', flex: 1, gap: 4 }, dot: { backgroundColor: colors.border, borderRadius: 4, height: 6, width: '100%' }, dotActive: { backgroundColor: colors.accent }, progressLabel: { color: colors.textMuted, fontSize: 10, textAlign: 'center' }, actions: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'flex-end' }, consent: { alignItems: 'flex-start', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 44 }, checkbox: { borderColor: colors.border, borderRadius: 4, borderWidth: 2, height: 24, width: 24 }, checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent }, consentText: { color: colors.textPrimary, flex: 1, lineHeight: 21 }, link: { color: colors.accentSoft, fontFamily: theme.font.bold }, footer: { color: colors.textSecondary, textAlign: 'center' } });
