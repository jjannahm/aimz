import { Bullet, LegalScreen, P, Section } from '@/src/components/LegalScreen';

export default function PrivacyPolicyScreen() {
  return <LegalScreen title="Privacy policy" summary="This policy explains what AIMZ Egypt collects, why it is needed, and the choices available to players and families.">
    <Section title="Who is responsible">
      <P>AIMZ Egypt, a girls’ football academy operating in Egypt, is responsible for the personal data used through this service. Privacy requests can be made through the AIMZ administrator or official academy contact that provided your invitation. The academy must publish its registered legal name, postal address, registration details, and a monitored privacy email before production launch.</P>
    </Section>
    <Section title="Data we use">
      <Bullet>Account details: name, email address, password hash, role, invitation, and sign-in/session records.</Bullet>
      <Bullet>Academy operations: team membership, attendance, availability, fixtures, scores, performance, fees, kit orders, announcements, and audit records.</Bullet>
      <Bullet>Newcomer applications: preferred branch, player name, contact details, date of birth, one parent or guardian contact, relevant football experience, and any health information you choose to provide.</Bullet>
      <Bullet>Photos only when an authorised academy user chooses and uploads them. The app does not request camera or microphone access.</Bullet>
      <Bullet>Technical information needed to operate and secure requests, such as IP address, request time, device/browser information supplied in network headers, and error/security logs held by our hosting providers.</Bullet>
    </Section>
    <Section title="Why we use it">
      <P>We use data to create and secure invited accounts; administer teams and academy services; respond to applications; protect players and the service; meet legal obligations; and handle requests or disputes. We do not sell personal data, run behavioural advertising, or use it for unrelated marketing.</P>
    </Section>
    <Section title="Sensitive data and children">
      <P>Date of birth, health information, and information about children need extra care. Health information is optional at the application stage and is used only to assess safe participation and reasonable support. A parent or legal guardian must submit or authorise an application for a player who cannot legally consent for herself. Consent may be withdrawn, but earlier lawful processing and records that must be retained may remain unaffected.</P>
    </Section>
    <Section title="Who receives data">
      <P>Access is limited by role to authorised AIMZ administrators, coaches, players, and parents or guardians where needed. Infrastructure providers process data to host the app, database, files, and email. The current web preview and API use Cloudflare services, and staging database data is located in Western Europe. AIMZ must complete and document its processor agreements and any required cross-border-transfer approval before real personal data is placed there.</P>
    </Section>
    <Section title="How long data is kept">
      <P>Account and academy records are kept while the account or operational record is needed. Security activity records are configured for 30-day retention. Newcomer personal data can be redacted by an administrator and is erased when an account is deleted, but an automatic production retention period for unsuccessful or abandoned applications has not yet been configured. AIMZ must set and enforce that period before collecting real applications.</P>
    </Section>
    <Section title="Your choices and rights">
      <P>Depending on the law that applies, you may ask to access, correct, update, transfer, restrict, object to, withdraw consent for, or erase your data, and may complain to Egypt’s Personal Data Protection Center. Identity may need to be verified before a request is fulfilled. Account deletion is available in the app; other requests can be made through the academy contact that issued the invitation.</P>
    </Section>
    <Section title="Security and changes">
      <P>We use access controls, encrypted HTTPS connections, password hashing, expiring sessions, and restricted private media access. No system can be guaranteed completely secure. Material policy changes will be dated and communicated through an appropriate academy channel.</P>
    </Section>
  </LegalScreen>;
}
