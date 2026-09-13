# AIMZ Egypt TestFlight and App Review Checklist

## Before building

- [x] Expo owner and project ID are pinned in `app.json`.
- Add the official 1024×1024 icon, splash image, and AIMZ logo as documented in `assets/branding/README.md`.
- Set `EXPO_PUBLIC_API_URL` to the production HTTPS API. A TestFlight build cannot use localhost.
- Configure PostgreSQL migrations, a strong JWT secret, SMTP, private S3-compatible storage, and the seeded review account on the production API.
- Verify the production API readiness endpoint returns 200 and test one photo upload.

## Build and submit

1. Run `pnpm typecheck`, `pnpm test`, and `npx expo export --platform ios`.
2. Run `eas build --platform ios --profile production`.
3. Install the resulting build on an internal tester device and complete both player and admin flows.
4. Run `eas submit --platform ios --profile production` after approving the final build.

## App Store Connect

- [x] Privacy policy is reachable inside the app from registration and Settings.
- [ ] Publish the privacy policy and a support page at stable production URLs owned by AIMZ Egypt, then add both URLs to App Store Connect.
- Declare account data, contact information, user-generated sports data, and uploaded photos accurately in App Privacy.
- Add review notes explaining that player registration requires an academy invitation code.
- Supply the seeded admin review email/password and a working invite code using App Store Connect's secure review-notes field—never commit them.
- Tell review where to find account deletion: **Settings → Delete account**.
- Confirm the App Privacy answers match `docs/app-store-readiness-2026-09-13.md` and the final production infrastructure.
- Explain that the admin role can start a match, add/correct events, finish it, and enter lineup minutes.
- Confirm screenshots contain consented or fictional player data and no minor's personal data is exposed publicly.
