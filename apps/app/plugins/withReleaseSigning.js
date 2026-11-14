/**
 * Config plugin: assina o APK/AAB de release com a chave própria do LendControl.
 * Lê as credenciais de propriedades Gradle (~/.gradle/gradle.properties ou -P na linha de comando):
 *   LENDCONTROL_STORE_FILE, LENDCONTROL_STORE_PASSWORD, LENDCONTROL_KEY_ALIAS, LENDCONTROL_KEY_PASSWORD
 * Sem essas propriedades, o release continua assinado com a chave de debug (só para testes).
 * A chave nunca vai para o repositório.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// lendcontrol-release-signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARK)) return cfg;
    src = src.replace(
      /signingConfigs\s*\{\s*\n(\s*)debug\s*\{/,
      (m, indent) =>
        `signingConfigs {\n${indent}${MARK}\n${indent}if (project.hasProperty('LENDCONTROL_STORE_FILE')) {\n` +
        `${indent}    release {\n` +
        `${indent}        storeFile file(LENDCONTROL_STORE_FILE)\n` +
        `${indent}        storePassword LENDCONTROL_STORE_PASSWORD\n` +
        `${indent}        keyAlias LENDCONTROL_KEY_ALIAS\n` +
        `${indent}        keyPassword LENDCONTROL_KEY_PASSWORD\n` +
        `${indent}    }\n${indent}}\n${indent}debug {`,
    );
    src = src.replace(
      /(release\s*\{\s*\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig project.hasProperty('LENDCONTROL_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );
    if (!src.includes("signingConfigs.release : signingConfigs.debug")) {
      throw new Error('withReleaseSigning: não encontrei o bloco buildTypes.release no build.gradle');
    }
    cfg.modResults.contents = src;
    return cfg;
  });
};
