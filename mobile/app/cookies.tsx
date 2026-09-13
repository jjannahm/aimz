import { Bullet, LegalScreen, P, Section } from '@/src/components/LegalScreen';

export default function CookiePolicyScreen() {
  return <LegalScreen title="Cookie policy" summary="AIMZ does not currently use advertising or analytics cookies. This page also explains the first-party storage the web app needs.">
    <Section title="Current use">
      <P>The AIMZ web app does not currently set browser cookies and does not load advertising pixels, behavioural analytics, or third-party media embeds. It uses first-party browser local storage for service-related functions.</P>
      <Bullet><P>AIMZ session (aimz.session.v1): keeps you signed in until you sign out or the stored session is cleared.</P></Bullet>
      <Bullet><P>Theme preference (aimz.theme.v1): remembers light, dark, or system appearance.</P></Bullet>
      <Bullet><P>Announcement state (aimz.announcements.seen.v1): remembers up to 200 announcement identifiers already shown on that device.</P></Bullet>
    </Section>
    <Section title="Consent">
      <P>These items are used only to provide a function you request, so the current site does not display a cookie consent banner. Clearing site data in browser settings removes them and signing out removes the stored session. Blocking storage may prevent sign-in or saved preferences from working.</P>
    </Section>
    <Section title="Future analytics or embeds">
      <P>If AIMZ adds non-essential analytics, advertising, or third-party embeds, they must remain disabled until a visitor has made an informed choice where consent is required. This policy and the consent control must then identify each provider, purpose, storage item, duration, and withdrawal method before those tools are released.</P>
    </Section>
  </LegalScreen>;
}
