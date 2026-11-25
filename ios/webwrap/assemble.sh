#!/bin/bash
# Builds the web-wrapper test app (a WKWebView around the website's own WASM build) into an unsigned IPA: out/TTWeb.ipa
#   bash ios/webwrap/assemble.sh <repo root>
# Env: PAGE_URL (default https://toontown.puffsco.com/play/?install=0), BUNDLE_ID, APP_NAME, DISPLAY_NAME, IPA_NAME, APP_VERSION, APP_BUILD
set -eu
W="$1"
SDK=$(xcrun --sdk iphoneos --show-sdk-path)
APP="$W/out/TTWeb.app"
rm -rf "$W/out"; mkdir -p "$APP"
PAGE="${PAGE_URL:-https://toontown.puffsco.com/play/?install=0}"
BUNDLE_ID="${BUNDLE_ID:-com.puffsco.toontownanywhere.web}"
APP_NAME="${APP_NAME:-Toontown: Anywhere (web test)}"
DISPLAY_NAME="${DISPLAY_NAME:-TT: Web Test}"
IPA_NAME="${IPA_NAME:-TTWeb.ipa}"

cat > "$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>TTWeb</string>
<key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
<key>CFBundleName</key><string>$APP_NAME</string>
<key>CFBundleDisplayName</key><string>$DISPLAY_NAME</string>
<key>CFBundleIcons</key><dict><key>CFBundlePrimaryIcon</key><dict><key>CFBundleIconFiles</key><array><string>AppIcon60x60</string></array><key>CFBundleIconName</key><string>AppIcon</string></dict></dict>
<key>CFBundleShortVersionString</key><string>0.1</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>MinimumOSVersion</key><string>15.0</string>
<key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
<key>UIRequiredDeviceCapabilities</key><array><string>arm64</string></array>
<key>UILaunchScreen</key><dict/>
<key>UIApplicationSceneManifest</key><dict><key>UIApplicationSupportsMultipleScenes</key><false/><key>UISceneConfigurations</key><dict><key>UIWindowSceneSessionRoleApplication</key><array><dict><key>UISceneConfigurationName</key><string>Default Configuration</string><key>UISceneDelegateClassName</key><string>SceneDelegate</string></dict></array></dict></dict>
<key>UIStatusBarHidden</key><true/>
<key>UIRequiresFullScreen</key><true/>
<key>UIViewControllerBasedStatusBarAppearance</key><true/>
<key>CADisableMinimumFrameDurationOnPhone</key><true/>
<key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationLandscapeRight</string><string>UIInterfaceOrientationLandscapeLeft</string></array>
<key>UISupportedInterfaceOrientations~ipad</key><array><string>UIInterfaceOrientationLandscapeRight</string><string>UIInterfaceOrientationLandscapeLeft</string></array>
</dict></plist>
PLIST
if [ -n "${APP_VERSION:-}" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $APP_VERSION" "$APP/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${APP_BUILD:-1}" "$APP/Info.plist"
fi

python3 -m pip install --quiet pillow > /dev/null 2>&1 || pip3 install --quiet pillow > /dev/null 2>&1 || true
python3 "$W/ios/panda_ios/make_icon.py" "$APP" || echo "icon generation failed (the default icon is used)"

xcrun --sdk iphoneos clang -arch arm64 -isysroot "$SDK" -miphoneos-version-min=15.0 -fobjc-arc -Wno-deprecated-declarations \
  -DPAGE_URL="@\"$PAGE\"" "$W/ios/webwrap/main.m" -framework UIKit -framework WebKit -framework Foundation -framework AVFoundation \
  -o "$APP/TTWeb"
[ -x "$APP/TTWeb" ] || { echo "FATAL: the executable was not built"; exit 1; }
mkdir -p "$W/out/Payload" && cp -R "$APP" "$W/out/Payload/" && (cd "$W/out" && zip -qr "$IPA_NAME" Payload) && ls -la "$W/out/$IPA_NAME"
