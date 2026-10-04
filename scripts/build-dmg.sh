#!/usr/bin/env bash
#
# build-dmg.sh: build a signed, notarized, stapled Jelly-<version>-arm64.dmg.
#
# The result opens on any Apple Silicon Mac with no "unidentified developer"
# warning, offline too. electron-builder signs the app, because an Electron app
# has many nested parts (frameworks, helper apps) that each need signing with
# the hardened runtime.
#
# Prerequisites, once per Mac:
#   * A "Developer ID Application" certificate in the login keychain.
#   * A notarytool keychain profile holding an Apple ID and app-specific password:
#       xcrun notarytool store-credentials "<profile>" --apple-id <id> --team-id <team>
#     NOTARY_PROFILE names it: NOTARY_PROFILE=<profile> npm run release
#   * npm install
#
# Usage:
#   scripts/build-dmg.sh               build, sign, notarize, staple, package, verify
#   scripts/build-dmg.sh --skip-build  reuse the last release build of the app
#
set -euo pipefail

NOTARY_PROFILE="${NOTARY_PROFILE:?Set NOTARY_PROFILE to your notarytool keychain profile, e.g. NOTARY_PROFILE=jelly npm run release}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT="$ROOT/dist-release"
APP="$OUT/mac-arm64/Jelly.app"
VERSION="$(node -p "require('./package.json').version")"
DMG="$OUT/Jelly-$VERSION-arm64.dmg"

SKIP_BUILD=0
[[ "${1:-}" == "--skip-build" ]] && SKIP_BUILD=1

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

# ---- 0. Preflight -----------------------------------------------------------
step "Preflight"
security find-identity -v -p codesigning | grep -q "Developer ID Application" \
  || { echo "✗ No Developer ID Application certificate in the keychain"; exit 1; }
xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 \
  || { echo "✗ notarytool profile '$NOTARY_PROFILE' is not usable (store-credentials, or an Apple agreement to accept)"; exit 1; }
[[ -d node_modules/electron-builder ]] || { echo "✗ Run npm install first"; exit 1; }
echo "✓ certificate, notary profile and tools present; version $VERSION"

# ---- 1. Build and sign the app -----------------------------------------------
if [[ "$SKIP_BUILD" == "0" ]]; then
  step "Building and signing Jelly.app (hardened runtime, timestamped)"
  rm -rf "$OUT"
  npx electron-builder --mac --config electron-builder.release.cjs \
    -c.directories.output="$OUT"
fi
[[ -d "$APP" ]] || { echo "✗ No app at $APP (drop --skip-build)"; exit 1; }

# ---- 1b. Only what is meant to ship ------------------------------------------
# package.json's "files" decides what goes in; this makes sure nothing personal
# or unused rode along: settings, logs, screenshots, the night sky, the table.
step "Checking the bundle holds only what ships"
BUNDLED="$APP/Contents/Resources/app"
STRAY="$(find "$BUNDLED" \( -name 'jelly.json' -o -name '*.log' -o -name 'night-*.exr' \
  -o -name 'wood_*' -o -name 'og_image.png' -o -name '*.dmg' -o -name '.DS_Store' \) -print)"
[[ -z "$STRAY" ]] || { echo "✗ Should not ship:"; echo "$STRAY"; exit 1; }
ls "$BUNDLED"
echo "✓ nothing stray"

step "Verifying the signature"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dv --verbose=4 "$APP" 2>&1 | grep -E "Authority=Developer ID Application|Timestamp=|flags=.*runtime" \
  || { echo "✗ Not signed with Developer ID, hardened runtime and a timestamp"; exit 1; }
echo "✓ signed for distribution"

# ---- 2. Notarize the app, then staple it so it is trusted offline -----------
step "Notarizing the app (uploading to Apple; this can take a few minutes)"
APP_ZIP="$(mktemp -d)/Jelly.zip"
ditto -c -k --keepParent "$APP" "$APP_ZIP"   # notarytool takes a zip, dmg or pkg, not a bare .app
xcrun notarytool submit "$APP_ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
rm -f "$APP_ZIP"

step "Stapling the ticket onto the app"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"

# ---- 3. The disk image, from the stapled app; notarized and stapled too ------
step "Building the disk image"
STAGING="$(mktemp -d)"
ditto "$APP" "$STAGING/Jelly.app"
ln -s /Applications "$STAGING/Applications"   # drag-to-install target
rm -f "$DMG"
hdiutil create -volname "Jelly $VERSION" -srcfolder "$STAGING" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGING"

step "Notarizing and stapling the disk image"
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

# ---- 4. What Gatekeeper sees ------------------------------------------------
step "Gatekeeper check of the app inside the disk image"
MOUNT="$(hdiutil attach "$DMG" -nobrowse -readonly | grep -o '/Volumes/.*' | head -1)"
VERDICT="$(spctl -a -vvv -t exec "$MOUNT/Jelly.app" 2>&1 || true)"
hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
echo "$VERDICT"
grep -q "accepted" <<<"$VERDICT" && grep -q "Notarized Developer ID" <<<"$VERDICT" \
  || { echo "✗ Gatekeeper did not accept it as notarized"; exit 1; }

(cd "$OUT" && shasum -a 256 "$(basename "$DMG")" | tee "$(basename "$DMG").sha256")
printf '\n\033[1;32m✓ Done: %s\033[0m\n' "$DMG"
