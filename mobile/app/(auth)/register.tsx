import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { AuthShell } from '@/src/components/AuthShell';
import { ChoiceField } from '@/src/components/ChoiceField';
import { FormField } from '@/src/components/FormField';
import { SeoHead } from '@/src/components/SeoHead';
import { ApiError, api } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { InviteContext, NewcomerApplicationPayload } from '@/src/types/api';

type Values = Omit<NewcomerApplicationPayload, 'full_name' | 'email' | 'consent'> & {
  inviteCode: string; name: string; email: string; password: string; consent: boolean;
  guardianAuthorization: boolean; healthConsent: boolean;
};
const empty: Values = { inviteCode: '', name: '', email: '', password: '', branch: '', mobile: '', whatsapp_mobile: '', date_of_birth: '', nationality: '', address: '', previous_academy: '', school_university: '', father_name: '', father_mobile: '', mother_name: '', mother_mobile: '', medical_concerns: '', medications: '', consent: false, guardianAuthorization: false, healthConsent: false };
const branches = ['AUC (East)', 'Gardenia (Agyal Park) (East)', 'Palm Hills Sporting Club (West)', "King’s School The Crown (West)"];
const playerSteps = ['Invitation', 'Account', 'Player', 'Family', 'Health'];
/** The fields that make the account itself, as against the application. */
const ACCOUNT_FIELDS: string[] = ['inviteCode', 'name', 'email', 'password'];

export default function RegisterScreen() {
  const styles = useThemedStyles(stylesheet);
  const params = useLocalSearchParams<{ code?: string }>();
  const { register } = useAuth();
  const [values, setValues] = useState<Values>({ ...empty, inviteCode: params.code ?? '' });
  const [errors, setErrors] = useState<Partial<Record<keyof Values | 'root', string>>>({});
  const [invite, setInvite] = useState<InviteContext | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const needsApplication = invite?.kind === 'newcomer';
  const steps = useMemo(() => needsApplication ? playerSteps : ['Invitation', 'Account'], [needsApplication]);
  const set = (field: keyof Values, value: string | boolean) => setValues((current) => ({ ...current, [field]: value }));

  /**
   * What a field says when it is not filled in.
   *
   * "Enter None if it does not apply" is advice for the application questions,
   * where a player with no previous academy still has to answer something. It
   * is nonsense on the account fields, and on a password it was advice nobody
   * should follow — which is what somebody eight characters in was being told.
   */
  const complaint = (field: keyof Values) => {
    if (field === 'consent') return 'Accept the terms and acknowledge the privacy policy to continue.';
    if (field === 'guardianAuthorization') return 'A parent or legal guardian must confirm this application.';
    if (field === 'healthConsent') return 'Consent is required before health information can be submitted.';
    if (field === 'password') return 'Use at least 8 characters.';
    return ACCOUNT_FIELDS.includes(field) ? 'This field is required.' : 'This field is required. Enter None if it does not apply.';
  };
  const checkFields = (fields: (keyof Values)[]) => {
    const next: typeof errors = {};
    for (const field of fields) {
      const value = values[field];
      if (value === false || String(value).trim().length < (field === 'password' ? 8 : 2)) next[field] = complaint(field);
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
    const fields: (keyof Values)[][] = [[], ['name', 'email', 'password'], ['branch', 'mobile', 'date_of_birth'], ['father_name', 'father_mobile'], []];
    if (checkFields(fields[step] ?? [])) setStep((current) => current + 1);
  };
  const submit = async () => {
    const includesHealthData = Boolean(values.medical_concerns.trim() || values.medications.trim());
    const finalFields: (keyof Values)[] = needsApplication
      ? ['consent', 'guardianAuthorization', ...(includesHealthData ? ['healthConsent' as const] : [])]
      : ['name', 'email', 'password'];
    if (!checkFields(finalFields)) return;
    setBusy(true);
    try {
      const application: NewcomerApplicationPayload | undefined = needsApplication ? {
        branch: values.branch, full_name: values.name, mobile: values.mobile, email: values.email,
        whatsapp_mobile: values.whatsapp_mobile.trim() || 'Not provided', date_of_birth: values.date_of_birth,
        nationality: 'Not collected', address: 'Not collected', previous_academy: values.previous_academy.trim() || 'Not provided',
        school_university: 'Not collected', father_name: values.father_name,
        father_mobile: values.father_mobile, mother_name: 'Not collected',
        mother_mobile: 'Not collected', medical_concerns: values.medical_concerns.trim() || 'Not provided',
        medications: values.medications.trim() || 'Not provided', consent: true, consent_version: '2026-09-13',
      } : undefined;
      await register(values.name, values.email, values.password, values.inviteCode, application);
    } catch (error) { setErrors({ root: error instanceof ApiError ? error.message : 'Could not create the account.' }); }
    finally { setBusy(false); }
  };
  return <AuthShell title={invite ? `Join as ${invite.kind}` : 'Join AIMZ'} subtitle={invite?.team_name ? `${invite.label} · ${invite.team_name}` : 'Use the invitation AIMZ sent you.'}>
    <SeoHead noIndex title="Use an AIMZ invitation | AIMZ Egypt" description="Create a private AIMZ Egypt account with an academy invitation." path="register" />
    <View style={styles.progress} accessibilityLabel={`Step ${step + 1} of ${steps.length}: ${steps[step]}`}>{steps.map((label, index) => <View key={label} style={styles.progressItem}><View style={[styles.dot, index <= step && styles.dotActive]} /><Text style={styles.progressLabel}>{label}</Text></View>)}</View>
    <View style={styles.form}>
      {errors.root ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{errors.root}</Text> : null}
      {step === 0 ? <><Input field="inviteCode" label="Academy invite code" values={values} errors={errors} set={set} editable={!params.code} /><AppButton label="Continue" loading={busy} onPress={() => void resolve()} /></> : null}
      {step === 1 ? <><Input field="name" label="Full name" values={values} errors={errors} set={set} /><Input field="email" label="Email" values={values} errors={errors} set={set} keyboardType="email-address" autoCapitalize="none" /><Input field="password" label="Password" hint="At least 8 characters" values={values} errors={errors} set={set} secureTextEntry /></> : null}
      {step === 2 ? <><ChoiceField error={errors.branch} label="Preferred branch" onChange={(value) => set('branch', value)} options={branches.map((value) => ({ label: value, value }))} placeholder="Choose a branch" value={values.branch} /><Input field="mobile" label="Primary contact number" values={values} errors={errors} set={set} keyboardType="phone-pad" autoComplete="tel" /><Input field="whatsapp_mobile" label="WhatsApp number (optional)" values={values} errors={errors} set={set} keyboardType="phone-pad" autoComplete="tel" /><Input field="date_of_birth" label="Player date of birth" hint="Required for age-group eligibility. Use YYYY-MM-DD." values={values} errors={errors} set={set} /><Input field="previous_academy" label="Previous club or academy (optional)" values={values} errors={errors} set={set} /></> : null}
      {step === 3 ? <><Input field="father_name" label="Parent or legal guardian name" values={values} errors={errors} set={set} autoComplete="name" /><Input field="father_mobile" label="Parent or legal guardian phone" values={values} errors={errors} set={set} keyboardType="phone-pad" autoComplete="tel" /></> : null}
      {step === 4 ? <><Text style={styles.optionalIntro}>Health information is optional at this stage. Share only what AIMZ needs to assess safe participation or support.</Text><Input field="medical_concerns" label="Relevant health or accessibility needs (optional)" values={values} errors={errors} set={set} multiline /><Input field="medications" label="Relevant medications (optional)" values={values} errors={errors} set={set} multiline />{values.medical_concerns.trim() || values.medications.trim() ? <Checkbox checked={values.healthConsent} error={errors.healthConsent} label="I explicitly consent to AIMZ using the health information above to assess safe participation and reasonable support." onPress={() => set('healthConsent', !values.healthConsent)} /> : null}<Checkbox checked={values.guardianAuthorization} error={errors.guardianAuthorization} label="I confirm that I am the player’s parent or legal guardian, or I am authorised by them to submit this application." onPress={() => set('guardianAuthorization', !values.guardianAuthorization)} /><Checkbox checked={values.consent} error={errors.consent} label="I agree to the Terms and Conditions and acknowledge that I have read the Privacy Policy, including how AIMZ uses the information needed to process this application." onPress={() => set('consent', !values.consent)} /><View style={styles.legalLinks}><Link href={'/privacy' as never} style={styles.link}>Read the Privacy Policy</Link><Link href={'/terms' as never} style={styles.link}>Read the Terms and Conditions</Link></View></> : null}
      {step > 0 ? <View style={styles.actions}><AppButton label="Back" onPress={() => setStep((current) => current - 1)} variant="ghost" />{step === steps.length - 1 ? <AppButton label="Create account" loading={busy} onPress={() => void submit()} /> : <AppButton label="Continue" onPress={next} />}</View> : null}
    </View>
    <Text style={styles.footer}>Already registered? <Link href="/(auth)/login" style={styles.link}>Sign in</Link></Text>
  </AuthShell>;
}

function Checkbox({ checked, error, label, onPress }: { checked: boolean; error?: string; label: string; onPress: () => void }) {
  const styles = useThemedStyles(stylesheet);
  return <View><Pressable accessibilityLabel={label} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={styles.consent}><View accessibilityElementsHidden style={[styles.checkbox, checked && styles.checkboxChecked]} /> <Text style={styles.consentText}>{label}</Text></Pressable>{error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}</View>;
}

function Input({ field, label, values, errors, set, ...props }: { field: keyof Values; label: string; values: Values; errors: Partial<Record<keyof Values | 'root', string>>; set: (field: keyof Values, value: string | boolean) => void; [key: string]: unknown }) {
  return <FormField {...props} error={errors[field]} label={label} onChangeText={(value) => set(field, value)} value={String(values[field] ?? '')} />;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ form: { gap: theme.spacing.md }, error: { backgroundColor: colors.errorSurface, borderRadius: theme.radius.sm, color: colors.errorText, padding: theme.spacing.md }, progress: { flexDirection: 'row', gap: theme.spacing.xs }, progressItem: { alignItems: 'center', flex: 1, gap: 4 }, dot: { backgroundColor: colors.border, borderRadius: 4, height: 6, width: '100%' }, dotActive: { backgroundColor: colors.accent }, progressLabel: { color: colors.textMuted, fontSize: 10, textAlign: 'center' }, actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, justifyContent: 'flex-end' }, consent: { alignItems: 'flex-start', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 44, paddingVertical: theme.spacing.xs }, checkbox: { borderColor: colors.textSecondary, borderRadius: 4, borderWidth: 2, height: 24, width: 24 }, checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent }, consentText: { color: colors.textPrimary, flex: 1, lineHeight: 22 }, legalLinks: { alignItems: 'flex-start', gap: theme.spacing.sm }, link: { color: colors.accentSoft, fontFamily: theme.font.bold, minHeight: theme.touch.minimum, paddingVertical: theme.spacing.sm }, footer: { color: colors.textSecondary, textAlign: 'center' }, optionalIntro: { color: colors.textSecondary, fontFamily: theme.font.regular, lineHeight: 23 } });
