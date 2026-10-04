// The release build: package.json's "build" settings, signed the way Apple
// requires for notarizing. `npm run app` skips all of this for speed (no
// hardened runtime, no timestamp: a timestamp is a round trip to Apple per
// signed file), which is fine for a copy that never leaves this Mac.
// Used by scripts/build-dmg.sh; arm64 only.
const { build } = require('./package.json');

module.exports = {
  ...build,
  mac: {
    ...build.mac,
    target: [{ target: 'dir', arch: ['arm64'] }],
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    timestamp: undefined,   // Apple's own timestamp server, as notarizing requires
    notarize: false,        // build-dmg.sh notarizes, so the app and the .dmg share one flow
  },
};
