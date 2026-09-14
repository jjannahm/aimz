# AIMZ Egypt store release checklist

The critical path is: **production backend → Expo project → production env →
privacy and support pages → store accounts and metadata → production builds.**
Nothing below can be usefully reordered; each step's output is the next one's
input.

## 1. Expo project

- [x] Owner account: `jjannah`, pinned as `expo.owner` in `app.json` so a build
      can never resolve to the other account.
- [x] `eas init` run. Project `@jjannah/aimz-egypt`, id
      `de21ff6c-5408-4687-863e-5342aab29cac`.
- [ ] Confirm `com.aimzegypt.scores` is permanent. It is the iOS bundle
      identifier and the Android package name, and neither can be changed after
      the first store submission.
- [x] Android: EAS generated and holds the release keystore for the
      `production` profile; its SHA-256 fingerprint is in `assetlinks.json`.
- [ ] iOS: let EAS manage signing. `eas credentials --platform ios` needs an
      Apple Developer account login, so it has to be run by hand.

## 2. Production backend

Everything deployed today is staging: the Worker `aimz-api-staging`, the Pages
site `aimz-egypt-staging.pages.dev`, the D1 database `aimz-staging-db`, and the
R2 bucket `aimz-staging-media`. `cloudflare-api/wrangler.jsonc` also defines
`env.production`, which nothing deploys yet: the production Worker does not
exist until the first `wrangler deploy --env production`.

- [x] `env.production` added to `wrangler.jsonc`, bound to its own
      `aimz-production-db` (`9c8593a9-43db-4742-9bd0-80c208a5429d`) and
      `aimz-production-media`, with rate-limit namespaces of its own. Both
      resources created, and neither bucket has a public r2.dev URL.
- [x] Production `vars` set. The web app is the Pages project
      `aimz-egypt-production` (created), so `FRONTEND_ORIGIN`,
      `PUBLIC_FORM_ORIGIN` and `TURNSTILE_HOSTNAMES` name
      `aimz-egypt-production.pages.dev`. Change all three together if it moves
      to a custom domain.
- [ ] Set the production secrets: `JWT_SECRET` (fresh, at least 32 characters,
      not the staging value), `DATA_ENCRYPTION_KEY` (at least 32 characters;
      never rotate once real data is sealed), `TURNSTILE_SECRET`,
      `INITIAL_INVITE_CODE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. The production
      Worker answers 503 until `JWT_SECRET` and `DATA_ENCRYPTION_KEY` are set.
- [ ] Apply the pending migrations, `0045_coach_staff_role.sql` and
      `0048_drop_unused_rate_limits.sql`. `0046` and `0047` are already applied;
      see `docs/production-d1-backup-restore.md` for how production got there:
      `npx wrangler d1 migrations apply aimz-production-db --env production --remote`.
- [ ] Deploy: `npx wrangler deploy --env production`.
- [x] Backup and restore procedure written and rehearsed once against the
      empty production database: `docs/production-d1-backup-restore.md`.
- [ ] Verify `/api/v1/health/ready` returns 200 against the production Worker.
- [ ] Verify one photo upload end to end, and that the URL it returns resolves.
- [ ] Verify CORS from the production web origin, and that rate limits hold.
- [x] `http://localhost` is no longer an allowed CORS origin in production; the
      Worker only accepts it outside production.

## 3. Production environment variables

A release build with no `EXPO_PUBLIC_API_URL`, or one that is not HTTPS,
refuses to start rather than falling back to localhost (`src/config.ts`).

- [x] `eas.json`'s `production` profile sets `EXPO_PUBLIC_API_URL` to
      `https://aimz-api-production.shared-links.workers.dev` and
      `EXPO_PUBLIC_WEB_ORIGIN` to `https://aimz-egypt-production.pages.dev`,
      with password reset off. (The `preview` profile points at staging.)

- [ ] Leave `EXPO_PUBLIC_ENABLE_PASSWORD_RESET` at `"false"` until password
      reset actually exists. Both endpoints in `cloudflare-api/src/auth.ts`
      throw 503 unconditionally and the Worker has no email provider, so
      enabling the flag ships a visible button that always fails — grounds for
      rejection under App Review guideline 2.1.
- [ ] Note that `mobile/.env` is gitignored and supplies `EXPO_PUBLIC_API_URL`
      locally. EAS builds from a clean checkout without it, so a missing `env`
      block does not reproduce on a developer machine.

## 4. Universal and app links

Neither value exists until the store accounts and EAS credentials do, so this
step follows step 1, not parallel to it.

- [ ] `public/.well-known/apple-app-site-association`: replace `TEAMID` with the
      Apple Team ID.
- [x] `public/.well-known/assetlinks.json` carries the EAS release keystore's
      SHA-256 fingerprint.
- [ ] Once the app is in Play Console, add the **app signing** key's SHA-256
      (Setup → App signing) to `assetlinks.json` as well. With Play App Signing,
      which new apps get by default, the EAS keystore only uploads; Google
      re-signs what users install, and links verify against Google's key.
- [x] `ios.associatedDomains` and the Android `intentFilters` host in `app.json`
      name `aimz-egypt-production.pages.dev`. Preview builds use the same
      `app.json`, so a staging invitation link no longer opens the app.
- [ ] Deploy the web app to the `aimz-egypt-production` Pages project, then
      confirm both files are served over HTTPS with no redirect and
      `content-type: application/json`.

## 5. Store accounts

- [ ] Apple Developer Program membership (required for TestFlight and the App
      Store).
- [ ] Google Play Developer membership.
- [ ] Create the AIMZ Egypt records in App Store Connect and Play Console.

## 6. Legal and metadata

- [x] The privacy policy, terms and cookie policy are reachable inside the app
      from registration and Settings (`app/privacy.tsx`, `app/terms.tsx`,
      `app/cookies.tsx`).
- [ ] Publish the privacy policy and a support page at stable production URLs
      owned by AIMZ Egypt, then add both URLs to App Store Connect and Play
      Console. Apple requires the privacy URL in store metadata as well as
      inside the app.
- [ ] Support URL and support email.
- [ ] Description, subtitle, keywords, category.
- [ ] Apple App Privacy answers and the Play Data Safety form: declare account
      data, contact information, user-generated sports data, and uploaded
      photos. Confirm they match `docs/app-store-readiness-2026-09-13.md` and
      the final production infrastructure.
- [ ] Age rating and content declarations.
- [ ] Written permission to display players' data and photographs. Most subjects
      are minors, which raises the bar on both stores.
- [ ] Review notes: registration requires an academy invitation code. Supply a
      seeded admin email, password, and a working invite code through App Store
      Connect's secure review-notes field — never commit them.
- [ ] Tell review where account deletion lives: **Settings → Delete account**
      (`app/(app)/(tabs)/settings.tsx`).
- [ ] Explain the admin role: start a match, add and correct events, finish it,
      and enter lineup minutes.

## 7. Assets

- [x] 1024×1024 icon (`assets/branding/icon.png`).
- [x] Splash screen, via the `expo-splash-screen` plugin in `app.json`.
- [x] Android adaptive icon
      (`assets/branding/adaptive-icon-foreground.png`, inset for the launcher
      mask).
- [x] `expo-system-ui` installed, so `userInterfaceStyle: "automatic"` is
      actually applied on Android. Without it the generated theme is not a
      DayNight theme and the default "Following your device" setting in
      Settings does not work.
- [x] The unused `CAMERA` and `RECORD_AUDIO` permissions that
      `expo-image-picker` declares are blocked. The app only ever opens the
      photo library, so asking for them would mean a Microphone entry on the
      Play listing and Data Safety answers about audio that is never recorded.
- [ ] Optional Play polish: a monochrome icon for Android 13 themed icons.
      This needs a single-colour silhouette of the mark, which does not exist
      and must come from whoever owns the artwork.
- [ ] Screenshots for iPhone, iPad, and Android, containing consented or
      fictional player data only, with no minor's personal data exposed.

`ios.supportsTablet` is `true`, so the iPad layout is reviewable and iPad
screenshots are mandatory. Set it to `false` if iPad is not intended.

## 8. Device testing

- [ ] Real iPhone and real Android hardware, small and large screens.
- [ ] Offline and slow-network behaviour.
- [ ] Photo permissions, including a denial.
- [ ] Login, account deletion.
- [ ] Player, parent, coach, and administrator permissions each behave as
      intended.

## 9. Build and submit

Local checks (pnpm is declared but is not installed on the working machine; npm
drives the pnpm-installed `node_modules`):

```bash
cd mobile
npx tsc --noEmit
npx jest --runInBand
npx expo export --platform ios
```

Then:

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production

eas build --platform android --profile production
eas submit --platform android --profile production
```

- [ ] Install the iOS build on an internal tester device and complete both a
      player and an admin flow before submitting.
