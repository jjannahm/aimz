# AIMZ Egypt TestFlight and App Review Checklist

## Before building

- Replace `REPLACE_WITH_EAS_PROJECT_ID` in `app.json` after running `eas init` with the club's Expo account.
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

- Provide the privacy-policy and support URLs owned by AIMZ Egypt.
- Declare account data, contact information, user-generated sports data, and uploaded photos accurately in App Privacy.
- Add review notes explaining that player registration requires an academy invitation code.
- Supply the seeded admin review email/password and a working invite code using App Store Connect's secure review-notes field—never commit them.
- Tell review where to find account deletion: **Settings → Delete account**.
- Explain that the admin role can start a match, add/correct events, finish it, and enter lineup minutes.
- Confirm screenshots contain consented or fictional player data and no minor's personal data is exposed publicly.
