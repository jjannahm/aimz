import { Bullet, LegalScreen, P, Section } from '@/src/components/LegalScreen';

export default function TermsScreen() {
  return <LegalScreen title="Terms and conditions" summary="These terms govern invited access to the AIMZ Egypt academy service.">
    <Section title="Operator and acceptance">
      <P>The service is operated by AIMZ Egypt, a girls’ football academy in Egypt. AIMZ must add its registered legal name, postal address, commercial registration details, and official contact before production launch. By creating or using an account, you agree to these terms and acknowledge the privacy policy. If you act for a child, you confirm that you are her parent or legal guardian, or are otherwise authorised to act for her.</P>
    </Section>
    <Section title="Accounts">
      <Bullet>Use only an invitation issued to you and provide accurate, current information.</Bullet>
      <Bullet>Keep credentials and private sharing links confidential, and tell AIMZ promptly if access may be compromised.</Bullet>
      <Bullet>Parents and guardians may access only children linked to their account; coaches may access only assigned squads; administrators must use their wider access solely for academy duties.</Bullet>
    </Section>
    <Section title="Acceptable use">
      <P>Do not access another person’s data without authority, scrape or probe the service, bypass security, upload unlawful or infringing material, interfere with operation, or use player information for unrelated purposes. AIMZ may restrict or suspend access where reasonably necessary to protect people, data, or the service.</P>
    </Section>
    <Section title="Scores and academy information">
      <P>Fixtures, scores, tables, statistics, attendance, availability, and notices are operational records and may be corrected. The service does not provide medical advice. Tell an appropriate coach or emergency professional directly about urgent health or safeguarding concerns; do not rely on the app for emergency communication.</P>
    </Section>
    <Section title="Content and intellectual property">
      <P>AIMZ owns or licenses the app, branding, and academy content. Clubs and other rights holders retain their rights in names, badges, photos, and supplied materials. Upload only content you are authorised to use and respect player image permissions. You may use the service only for its intended academy purpose.</P>
    </Section>
    <Section title="Availability and responsibility">
      <P>The service may be changed, interrupted, or withdrawn for maintenance, security, legal, or operational reasons. Nothing in these terms excludes liability or consumer rights that cannot lawfully be excluded. Any responsibility is determined under applicable law and the facts of the matter.</P>
    </Section>
    <Section title="Ending access and governing law">
      <P>You may stop using the service and request account deletion. AIMZ may end access when an invitation or account expires, academy participation ends, or these terms are materially breached. Egyptian law governs these terms, subject to any mandatory rights that apply where a user lives. Contact the AIMZ administrator or official academy channel that issued your invitation with questions.</P>
    </Section>
  </LegalScreen>;
}
