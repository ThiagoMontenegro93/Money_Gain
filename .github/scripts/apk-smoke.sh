#!/usr/bin/env bash
# Teste do APK no emulador: instala, abre, espera a tela de entrada e confere que não houve crash.
set -uo pipefail
APK_DIR="${1:-apk}"
PKG=app.lendcontrol.pro
OUT=emulador
mkdir -p "$OUT"
APK=$(ls "$APK_DIR"/*.apk | head -1)
echo "==> instalando $APK"
adb install -r -g "$APK" || { echo "::error::APK não instalou"; exit 1; }
adb logcat -c
echo "==> abrindo o app"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null
found=""
for i in $(seq 1 45); do
  sleep 2
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 && adb pull /sdcard/ui.xml "$OUT/ui.xml" > /dev/null 2>&1
  if grep -qE 'Entrar|Testar e salvar|LendControl' "$OUT/ui.xml" 2>/dev/null; then found=1; break; fi
done
adb exec-out screencap -p > "$OUT/tela-inicial.png"
adb logcat -d > "$OUT/logcat.txt"
if grep -E "FATAL EXCEPTION|AndroidRuntime: Process: $PKG" "$OUT/logcat.txt" | head -5 | grep -q .; then
  grep -A20 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -40
  echo "::error::o app fechou sozinho (crash) ao abrir"; exit 1
fi
if ! adb shell pidof "$PKG" > /dev/null; then echo "::error::o app não está rodando depois de abrir"; exit 1; fi
if [[ -z "$found" ]]; then echo "::error::a tela de entrada não apareceu em 90 s"; exit 1; fi
echo "==> rotação (tela deitada) e volta"
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1; sleep 3
adb exec-out screencap -p > "$OUT/tela-deitada.png"
adb shell settings put system user_rotation 0; sleep 2
adb logcat -d > "$OUT/logcat.txt"
if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt" || ! adb shell pidof "$PKG" > /dev/null; then echo "::error::o app fechou ao girar a tela"; exit 1; fi
echo "APK OK: instalou, abriu a tela de entrada e não fechou sozinho"
