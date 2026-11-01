#!/usr/bin/env bash
# Builds poker/android/build/BlueFeltPoker.apk without Android Studio or the Android SDK.
# Needs: Java 17+ (javac, keytool), python3, curl, zip. Tools come from Maven Central and are cached in .tools/.
set -euo pipefail
cd "$(dirname "$0")"
HERE=$(pwd)
T=$HERE/.tools
B=$HERE/build
mkdir -p "$T" "$B"

get() { # get <maven path> <file>
  [ -s "$T/$2" ] && return 0
  for i in 1 2 3 4 5 6; do
    curl -sSf -o "$T/$2" "https://repo1.maven.org/maven2/$1" && return 0
    sleep 5
  done
  echo "download failed: $1" >&2; exit 1
}
get org/apktool/apktool-lib/3.0.3/apktool-lib-3.0.3.jar apktool-lib.jar          # aapt2 + framework resources
get com/google/android/android/4.1.1.4/android-4.1.1.4.jar android-stubs.jar     # Android API stubs for javac
get com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar dx.jar
get com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar apksig.jar
if [ ! -x "$T/prebuilt/linux/aapt2" ]; then
  (cd "$T" && unzip -o -q apktool-lib.jar prebuilt/linux/aapt2 prebuilt/android-framework.jar && chmod +x prebuilt/linux/aapt2)
fi
AAPT2=$T/prebuilt/linux/aapt2
FRAMEWORK=$T/prebuilt/android-framework.jar

VERSION_CODE=${VERSION_CODE:-1}
VERSION_NAME=${VERSION_NAME:-1.0}

rm -rf "$B/assets" "$B/classes" "$B"/*.apk "$B/res.zip" "$B/classes.dex"
# 1) Web game -> assets
mkdir -p "$B/assets"
cp -r ../index.html ../css ../js ../icon.svg ../manifest.webmanifest "$B/assets/"

# 2) Resources + manifest
"$AAPT2" compile --dir res -o "$B/res.zip"
"$AAPT2" link -o "$B/unsigned.apk" -I "$FRAMEWORK" --manifest AndroidManifest.xml \
  -A "$B/assets" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$B/res.zip"

# 3) Java -> dex
mkdir -p "$B/classes"
javac -nowarn -Xlint:-options --release 8 -cp "$T/android-stubs.jar" \
  -d "$B/classes" $(find src -name '*.java')
java -cp "$T/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=24 --output="$B/classes.dex" "$B/classes"
(cd "$B" && zip -q -j unsigned.apk classes.dex)

# 4) Align + sign
KS=${KEYSTORE:-$HERE/release.p12}
PASS=${KEYSTORE_PASS:-bluefeltpoker}
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storetype PKCS12 -storepass "$PASS" -keypass "$PASS" \
    -alias poker -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Blue Felt Poker" >/dev/null 2>&1
fi
# Align, then sign (APK Signature Scheme v2, Android 7.0+)
python3 tools/align.py "$B/unsigned.apk" "$B/aligned.apk"
mkdir -p "$B/signer"
javac -nowarn -cp "$T/apksig.jar" -d "$B/signer" tools/Sign.java
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-exports java.base/sun.security.util=ALL-UNNAMED -cp "$T/apksig.jar:$B/signer" Sign "$B/aligned.apk" "$B/BlueFeltPoker.apk" "$KS" "$PASS" poker
python3 tools/align.py --check "$B/BlueFeltPoker.apk"
rm -f "$B/unsigned.apk" "$B/aligned.apk"
echo "Built: $B/BlueFeltPoker.apk"
