# Mobile dependency security triage

Reviewed 14 September 2026 with `pnpm audit --prod` against the committed lockfile.

## Result

The original report contained 19 high and 6 moderate advisories across five transitive packages. Every path entered through Expo development/build infrastructure: Metro image inspection, Expo configuration and plist processing, Xcode project generation, Expo Router query parsing, or Jest coverage configuration. None of these packages is imported by AIMZ application code or shipped as application business logic.

The risk is therefore build-time denial of service or unsafe processing of a malicious repository/configuration asset, not remote exploitation through a signed production application. Repository writes and build inputs remain restricted to trusted maintainers.

## Remediation

Patched versions are forced at the narrow parent dependency edge, under `overrides` in `mobile/pnpm-workspace.yaml` (pnpm 11 no longer reads the `pnpm` field of `package.json`):

- `metro > image-size`: `2.0.3`
- `@expo/plist > @xmldom/xmldom`: `0.8.15`
- `plist > @xmldom/xmldom`: `0.9.12`
- `xcode > uuid`: `11.1.1`
- `query-string > decode-uri-component`: `0.5.0` (the registry contains no `0.4.3`, despite the advisory metadata naming it as the first patched release)
- `@expo/xcpretty > js-yaml`: `4.3.2`
- `@istanbuljs/load-nyc-config > js-yaml`: `3.15.2`

Two consequences of the pins:

- `image-size@2.0.3` was younger than the workspace's minimum release age when it was pinned, so it is listed in `minimumReleaseAgeExclude`. Remove that exception once the release has aged past the policy.
- `decode-uri-component@0.5.0` ships as ESM, so `mobile/jest.config.js` adds it to the packages Jest transpiles.

These overrides must remain only while Expo's supported dependency graph has not absorbed the patched releases. Every Expo SDK upgrade should remove each override experimentally, regenerate the lockfile, and rerun the audit, native configuration generation, typecheck, tests, and web export.
