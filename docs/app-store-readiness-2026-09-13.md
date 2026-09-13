# AIMZ Egypt App Store readiness audit

Audit date: 13 September 2026

Target: Apple App Store, iOS/iPadOS

Method: `mjmirza/app-store-compliance` automated guard, Expo native-config introspection, source and dependency review, and the current Apple App Review Guidelines.

## Verdict

**Blocked from submission.** The checked-in app code has no unresolved App Store code blocker after the fixes in this change, but the release cannot be submitted until the owner completes the external items below. App Review acceptance can never be guaranteed.

## Release blockers requiring the owner

1. **Production service and domain.** `mobile/eas.json` intentionally has no production API or web origin. Add the live HTTPS API and public site only after both are deployed and tested. Never substitute staging URLs in a production build.
2. **Legal identity and support details.** Replace the launch warnings inside the privacy policy and terms with AIMZ's registered legal name, postal address, commercial-registration details, monitored privacy email, and support contact. Publish a reachable support URL and privacy-policy URL.
3. **Universal-link credentials.** Replace `TEAMID` in `mobile/public/.well-known/apple-app-site-association`, use the production host in `mobile/app.json`, and serve the file over HTTPS without redirects. Until this is complete, remove the associated-domains entitlement from a submission rather than claim a broken link feature.
4. **Reviewer access.** Seed a non-expiring, fully populated review account. Put its credentials and a working invitation code in App Store Connect Review Notes, never in the repository. Keep the production backend available throughout review.
5. **Store metadata.** Provide truthful screenshots of real app functionality using fictional or properly consented player data; complete the current age-rating questionnaire; add the privacy and support URLs; and use an international-format review phone number.
6. **Children and image rights.** Keep written parent/guardian authority for minor accounts, health details, player photographs, and any club badges or third-party marks. Do not submit screenshots containing identifiable minors without documented permission.
7. **Device evidence.** Test the archive on supported physical iPhone and iPad devices with VoiceOver, Larger Text, Reduce Motion, denied photo permission, offline/slow networking, and every role. Because `supportsTablet` is true, iPad operation and screenshots are part of review.

## App Privacy answers to mirror in App Store Connect

The app declares no tracking and contains no advertising or analytics SDK. All linked data below is used for App Functionality only:

- Contact Info: Name, Email Address, Phone Number, Physical Address.
- Health & Fitness: Health and Fitness.
- User Content: Photos or Videos and Other User Content.
- Identifiers: User ID.
- Purchases: Payment Info and Purchase History (academy fee/payment records and kit orders; no card credentials are collected by the app).
- Other Data: date of birth, nationality, academy/school history, role, squad and operational sports records.
- Diagnostics: security/request information such as IP-derived rate-limit keys, not linked for advertising and not used for tracking.

Re-check these answers against the production infrastructure and every added SDK before each submission. If crash reporting, analytics, advertising, payments, push, or another SDK is added, update both the manifest and App Store Connect before uploading.

## Review Notes draft

Use the following structure in App Store Connect and replace each bracketed owner-only value:

> AIMZ Egypt is an invitation-only academy operations app. Core account features require sign-in. Reviewer account: [EMAIL] / [PASSWORD]. The account does not require reviewer-controlled 2FA and will remain active throughout review. A working registration invitation is [INVITE CODE].
>
> Player/parent flow: sign in, view the linked squad, fixtures, results, attendance and player information. Administrator flow: manage teams and players, start a match, add or correct events, enter lineup minutes, and finish the match. Account deletion is at Settings > Delete account and permanently removes the login while personal newcomer-application fields are redacted. Privacy Policy, Terms, and Cookie and Storage Policy are linked in Settings.
>
> The photo-library permission appears only when an authorised administrator chooses to upload a player or team image. The app does not request camera, microphone, location, contacts, advertising identifier, or tracking permission. It contains no advertising, analytics, in-app purchase, external payment, social login, or generative AI integration.

## Automated-guard interpretation

The third-party guard reports two web findings. Both require manual interpretation:

- `WEB-LOCAL-STORAGE`: valid for the web build, which stores its bearer session in first-party local storage. Native iOS uses `expo-secure-store` with this-device-only Keychain accessibility. This is a web security risk, not an iOS App Store rejection trigger.
- `WEB-TRACKING-TECHNOLOGIES`: false positive caused by matching a substring in package-lock integrity hashes. Source review found no tracking SDK or tracking call.

The guard reports `iOS=0` because this is a managed Expo project without a committed native `ios/` folder. The Expo config was therefore introspected separately. The generated config has a specific photo-library purpose string, export-compliance declaration, tracking disabled, and an app privacy manifest.

## Implemented by this audit

- Redact newcomer personal/health fields and staff notes transactionally before production account deletion.
- Add an integration test proving deletion removes the account and redacts retained operational records.
- Add Privacy, Terms, and Cookie and Storage links to authenticated Settings.
- Add an app-level Apple privacy manifest matching the current data model and aggregating required-reason API declarations used by Expo/React Native dependencies.
- Disable arbitrary iOS transport loads explicitly.
- Restore the verified Expo owner/project ID and block unused camera and microphone permissions.
- Remove the obsolete Expo `newArchEnabled` key; Expo Doctor now passes all 21 checks.
- Upgrade Hono to the patched production version; `npm audit --omit=dev` now reports zero vulnerabilities.

## Verification completed

- Expo Doctor: 21/21 checks passed.
- Mobile: TypeScript passed; 85 suites and 651 tests passed.
- Cloudflare API: TypeScript passed; 74 unit tests and 164 D1 integration tests passed.
- iOS JavaScript export completed successfully.
- Production dependency audit: zero known vulnerabilities.

## Primary references

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple account deletion guidance: https://developer.apple.com/support/offering-account-deletion-in-your-app
- Apple App Privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Apple privacy manifests: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- Expo privacy manifest configuration: https://docs.expo.dev/guides/apple-privacy/
