# App Android (APK) e iPhone

O app do celular é o mesmo código do `apps/app` (Expo / React Native). Ele **não guarda os dados no aparelho**:
conversa com a API do LendControl (`apps/api`), igual à versão web. Por isso o celular precisa alcançar o servidor.

## Instalar o APK no Android

1. Copie `lendcontrol-pro-v6.5.0.apk` para o celular (WhatsApp, Google Drive, cabo USB…).
2. Toque no arquivo. Na primeira vez o Android pede para **permitir instalar apps desta fonte**: permita.
3. Abra o **LendControl Pro**. Na primeira abertura aparece **Servidor do LendControl**:
   - **Mesma rede Wi-Fi** (servidor rodando no seu computador): digite o IP do computador e a porta, ex. `192.168.0.10:3000`.
     No Windows, o IP aparece em `ipconfig` (Endereço IPv4). Libere a porta 3000 no Firewall do Windows.
   - **Pela internet** (servidor publicado com domínio e HTTPS, ver [DEPLOY.md](DEPLOY.md)): digite `https://seu-dominio.com`.
4. Toque em **Testar e salvar**. O app confere `/api/health` antes de salvar. Depois é só entrar com e-mail e senha.

O endereço fica salvo no aparelho; para trocar, use **Alterar servidor** na tela de login.
Endereços sem `https://` só funcionam na rede local (o app aceita HTTP para isso).

Requisitos: Android 7.0 ou superior (arm64, armv7 ou x86_64).

## iPhone

A Apple **não instala APK** e não permite instalar apps fora da App Store/TestFlight sem conta de desenvolvedor. Opções:

- **Agora, sem custo:** abrir o sistema no Safari (`https://seu-dominio.com`) e tocar em *Compartilhar → Adicionar à Tela de Início*.
  Fica com ícone e abre em tela cheia, usando a versão web (precisa do servidor publicado com HTTPS).
- **App nativo:** conta Apple Developer (US$ 99/ano) + `eas build -p ios` e distribuição pelo **TestFlight** (até 10.000 testadores)
  ou App Store. O código já está pronto para iOS (`bundleIdentifier` `app.lendcontrol.pro`).

## Gerar um novo APK

### Pelo GitHub (recomendado)
O workflow **Android APK** (`.github/workflows/android-apk.yml`) gera o APK a cada mudança no app e guarda como artefato do
Actions (30 dias). Em *Actions → Android APK → Run workflow*, marcar *prerelease* também publica o APK em *Releases*.

Para o CI assinar com a chave oficial, cadastre em *Settings → Secrets and variables → Actions*:
- `LENDCONTROL_KEYSTORE_BASE64`: `base64 -w0 lendcontrol-release.keystore`
- `LENDCONTROL_KEYSTORE_PASSWORD`: senha do arquivo `keystore.properties`
- (opcional) variável `EXPO_PUBLIC_API_URL` = `https://seu-dominio.com/api` para já vir com o servidor preenchido.

Sem os secrets, o APK sai assinado com a chave de debug. Para assinar depois com a chave oficial:
```bash
zipalign -p -f 4 app-release.apk alinhado.apk
apksigner sign --ks lendcontrol-release.keystore --ks-key-alias lendcontrol --out lendcontrol-pro.apk alinhado.apk
apksigner verify --print-certs lendcontrol-pro.apk
```

### Na sua máquina
Pré-requisitos: Node 20+, pnpm, JDK 17, Android SDK (platform 36, build-tools 36.0.0, NDK 27.1).
```bash
cd apps/app
ANDROID_HOME=~/Android/Sdk KEYSTORE_PROPS=/caminho/keystore.properties ./scripts/build-apk.sh
# APK em apps/app/dist-android/
```

## Chave de assinatura (importante)

O Android só aceita **atualizar** um app instalado se o novo APK tiver a **mesma assinatura**. A chave
(`lendcontrol-release.keystore` + `keystore.properties`) fica fora do Git. Guarde uma cópia em local seguro:
se ela se perder, será preciso desinstalar o app (perdendo a fila offline do aparelho) para instalar uma versão nova.
A cada nova versão, aumente `android.versionCode` em `apps/app/app.json`.

## Permissões pedidas
Internet, câmera e fotos (anexar comprovantes e documentos) e biometria (confirmar aprovações).
