# AIMZ privacy, content, and accessibility review

Reviewed 13 September 2026. This is an implementation review, not a substitute for advice from an Egyptian lawyer or the Personal Data Protection Center (PDPC).

## Implemented

- Public privacy, terms and conditions, and cookie/storage pages, linked from every sign-in and registration screen.
- No cookie banner. The source contains no analytics, advertising pixels, tag managers, or third-party embeds. The web app uses first-party `localStorage` only for the session, theme preference, and up to 200 seen-announcement identifiers. If non-essential tracking or embeds are introduced, they must be blocked until any legally required opt-in.
- Registration now collects a preferred branch, player/account identity and contact details, date of birth, and one parent/guardian contact. Nationality, home address, school/university, and a second parent's details were removed from the visible form. WhatsApp, football history, and health details are optional.
- Separate confirmations cover parent/guardian authority, terms/privacy acknowledgement, and explicit use of health data when health information is entered. The recorded consent version is `2026-09-13`.
- Sign-in copy no longer makes promotional claims. Repository searches found no testimonials, reviews, star ratings, customer counts, “best”, “leading”, “#1”, or guarantee claims on the public/authentication surface.
- The light-theme error message surface was corrected from 1.74:1 contrast to a pale error surface with readable dark-red text. Auth controls have persistent labels, 44-point minimum targets, visible input focus borders, named buttons, checkbox roles/states, live error regions, and keyboard-safe scrolling.
- Meaningful branding has an accessible image label. Player and club images in the reviewed source are hidden from assistive technology only where the adjacent interface already supplies the player's or club's name, avoiding duplicate announcements.

## Legal framework checked

- Egypt Personal Data Protection Law No. 151 of 2020 and Executive Regulations No. 816 of 2025. The PDPC identifies these as the current framework and describes controller/processor, licensing, DPO, data-subject-rights, and compliance obligations: <https://www.pdpc.gov.eg/>.
- Egypt Consumer Protection Law No. 181 of 2018 may apply to representations and consumer-facing terms. Egypt's State Information Service lists it as protecting against unfair commercial practices online: <https://sis.gov.eg/en/media-center/events/ai-everything-middle-east-africa-summit-and-exhibition/>.
- EU ePrivacy rules may apply to storage or access on devices of visitors in the EEA. Strictly necessary storage is exempt from the general consent rule; non-essential analytics or embed storage generally is not: <https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=celex%3A32002L0058>.
- If the service is offered to children in the EEA and relies on consent, GDPR Article 8 requires verified parental authorisation below the applicable national age (13–16): <https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CONSIL%3APE_17_2016_INIT>.

## Release blockers requiring owner or lawyer input

1. **Business identity:** the repository proves only the trading/product name “AIMZ Egypt” and that it is an Egyptian girls' football academy. Add the registered legal entity name, postal address, commercial/tax registration details as applicable, monitored privacy/support email, and telephone. These were deliberately not invented.
2. **PDPC compliance:** confirm required controller/processor licences or permits, appoint and register a DPO if required, create the processing register, complete the required privacy impact/risk assessments, and document data-subject and breach-response procedures under the 2025 regulations.
3. **Children and safeguarding:** define who may create a player account, the age threshold, how guardian authority is verified, and the academy's safeguarding escalation process. A checkbox records a statement; it does not by itself verify guardianship.
4. **Sensitive data:** obtain Egyptian counsel's approval for the legal basis, wording, access, retention, and any required permit for health and children's data. Decide whether health information is needed at application time or should be collected later by authorised staff.
5. **Retention:** the API supports administrator redaction and account deletion, and Cloudflare audit records expire after 30 days, but no automatic deadline exists for abandoned or unsuccessful applications. Set, disclose, and technically enforce one before production.
6. **International transfers and processors:** the staging D1 location is documented as Western Europe. Inventory production locations and subprocessors, sign appropriate processing terms, and obtain any Egyptian transfer authorisation required before real data is transferred.
7. **Staging:** project documentation says the public preview is disposable and must contain fictional data only. Do not accept real player, family, health, or academy data there.
8. **Image rights:** no licence, assignment, consent record, or source metadata was found for `aimz_logo.svg`, app branding PNGs, or the club badge files under `clubs/` and `clubs-ready/`. Club badges are likely third-party marks. Keep them only after recording permission or another valid basis. For player/team uploads, record photographer/rights-holder permission and a parent/guardian image release, define where images may be displayed, and honour withdrawal. File presence is not proof of copyright permission.
9. **Terms:** have Egyptian counsel review consumer rights, suspension, liability, governing law, academy membership terms, fees/refunds, and dispute handling. The app terms intentionally do not attempt to waive rights that cannot be waived.
10. **Accessibility verification:** source-level improvements do not prove full WCAG 2.2 AA conformance. Test exported web pages with keyboard only, VoiceOver/TalkBack, 200% zoom, light/dark themes, and automated tooling; test native Dynamic Type/font scaling and screen-reader focus order on physical devices.

## Change-control guardrails

- Do not add analytics, pixels, session replay, advertising, social/video embeds, chat widgets, or externally hosted form tools without updating the data inventory and completing the consent assessment before loading them.
- Do not add reviews, performance promises, customer/player counts, awards, safety claims, or partner logos without dated evidence and permission.
- Keep every form field tied to a documented purpose, legal basis, access group, and retention period. Optional fields must remain genuinely optional.
