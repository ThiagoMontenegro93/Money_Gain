#!/usr/bin/env bash
# Gera o APK instalável do LendControl Pro (Android) localmente, sem conta Expo.
#
# Pré-requisitos: Node 20+, pnpm, JDK 17 ou 21, Android SDK (platform 36, build-tools 36.0.0, NDK 27.1)
#   ANDROID_HOME=/caminho/do/sdk
# Assinatura (opcional, recomendado): arquivo keystore.properties com LENDCONTROL_STORE_FILE,
#   LENDCONTROL_STORE_PASSWORD, LENDCONTROL_KEY_ALIAS, LENDCONTROL_KEY_PASSWORD
#   KEYSTORE_PROPS=/caminho/keystore.properties ./scripts/build-apk.sh
# Servidor padrão embutido (opcional; o usuário pode trocar na tela de login):
#   EXPO_PUBLIC_API_URL=https://seu-dominio/api ./scripts/build-apk.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${ANDROID_HOME:?defina ANDROID_HOME com o caminho do Android SDK}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

echo "==> core"
(cd ../.. && pnpm build:core)

echo "==> prebuild (gera a pasta android/ a partir do app.json)"
rm -rf android
CI=1 npx expo prebuild --platform android --no-install
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

GRADLE_ARGS=(assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64)
if [[ -n "${KEYSTORE_PROPS:-}" ]]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^LENDCONTROL_ ]] && GRADLE_ARGS+=("-P$k=$v")
  done < "$KEYSTORE_PROPS"
  echo "==> assinando com a chave de release"
else
  echo "!! KEYSTORE_PROPS não definido: APK assinado com chave de debug (apenas para testes)"
fi

echo "==> gradle"
(cd android && ./gradlew "${GRADLE_ARGS[@]}")

VERSION=$(node -p "require('./app.json').expo.version")
OUT="dist-android/lendcontrol-pro-v${VERSION}.apk"
mkdir -p dist-android
cp android/app/build/outputs/apk/release/app-release.apk "$OUT"
echo "==> APK pronto: apps/app/$OUT"
