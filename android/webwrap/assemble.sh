#!/bin/bash
# Builds the Android web-wrapper app (a WebView around the website's own WASM build) into a signed APK: out/TTAnywhere.apk
#   bash android/webwrap/assemble.sh <repo root>
# Env: PAGE_URL (default https://toontown.puffsco.com/play/?install=0), APP_VERSION (default 0.1), APP_BUILD (default 1),
#      KEYSTORE / KEYSTORE_PASS (the signing key; without one a throwaway key is made, fine for a trial, but an APK signed that way cannot update
#      one signed with the real key), ANDROID_HOME (set on the GitHub runners).
set -eu
W="$1"
SRC="$W/android/webwrap"
OUT="$W/out"
rm -rf "$OUT"; mkdir -p "$OUT/res/values" "$OUT/gen" "$OUT/obj" "$OUT/dex"
PAGE="${PAGE_URL:-https://toontown.puffsco.com/play/?install=0}"
VER="${APP_VERSION:-0.1}"
CODE="${APP_BUILD:-1}"
: "${ANDROID_HOME:?ANDROID_HOME is not set}"
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
AJ=$(ls -d "$ANDROID_HOME"/platforms/android-* | sort -V | tail -1)/android.jar
echo "build-tools $BT, $AJ"

cat > "$OUT/res/values/strings.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">TT: Anywhere</string>
    <string name="page_url">${PAGE//&/&amp;}</string>
</resources>
XML

# launcher icon, drawn from the same picture as the iOS app's
python3 -m pip install --quiet pillow > /dev/null 2>&1 || true
python3 "$W/ios/panda_ios/make_icon.py" "$OUT/icon" > /dev/null
python3 - "$OUT" <<'PY'
import os, sys
from PIL import Image
out = sys.argv[1]
im = Image.open(os.path.join(out, "icon", "AppIcon-1024.png")).convert("RGBA")
for d, px in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
    p = os.path.join(out, "res", "mipmap-" + d)
    os.makedirs(p, exist_ok=True)
    im.resize((px, px), Image.LANCZOS).save(os.path.join(p, "ic_launcher.png"))
PY

"$BT/aapt2" compile --dir "$OUT/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$AJ" --manifest "$SRC/AndroidManifest.xml" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$CODE" --version-name "$VER" --java "$OUT/gen" "$OUT/res.zip"
javac --release 11 -classpath "$AJ" -d "$OUT/obj" $(find "$SRC/src" "$OUT/gen" -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$AJ" --output "$OUT/dex" $(find "$OUT/obj" -name '*.class')
cp "$OUT/base.apk" "$OUT/unaligned.apk"
(cd "$OUT/dex" && zip -q ../unaligned.apk classes.dex)
"$BT/zipalign" -f -p 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

KS="${KEYSTORE:-}"
PASS="${KEYSTORE_PASS:-}"
if [ -z "$KS" ] || [ ! -f "$KS" ]; then
  echo "WARNING: no signing key given, signing with a throwaway key (this APK cannot update an APK signed with the real key)"
  KS="$OUT/throwaway.jks"; PASS="throwaway"
  keytool -genkeypair -keystore "$KS" -storepass "$PASS" -keypass "$PASS" -alias tta -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Toontown Anywhere trial" > /dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$PASS" --ks-key-alias tta --key-pass "pass:$PASS" --out "$OUT/TTAnywhere.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --print-certs "$OUT/TTAnywhere.apk" | head -3
ls -la "$OUT/TTAnywhere.apk"
