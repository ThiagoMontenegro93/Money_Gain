# Colocar o LendControl no ar

## 1. Servidor (VPS) com Docker

Requisitos: um servidor Linux com Docker (2 GB de RAM é suficiente) e, para HTTPS, um domínio apontando para ele.

```bash
git clone <seu-repositório> lendcontrol && cd lendcontrol
cp .env.prod.example .env.prod
# preencha .env.prod: gere cada segredo com
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile https up -d --build
```

- Uma única imagem serve o app web em `/` e a API em `/api` (mesma origem). As migrações do banco rodam sozinhas a cada início.
- O perfil `https` sobe o Caddy, que emite e renova o certificado HTTPS para o `DOMAIN`. Sem ele, o app fica na porta `APP_PORT`.
- Volumes: `pgdata` (banco), `appdata` (fotos, comprovantes e planilhas de backup), `dbbackups` (cópias diárias do banco com retenção de 14 dias, 8 semanas e 6 meses).
- **Primeiro acesso**: o banco começa vazio. Com `OWNER_EMAIL` e `OWNER_PASSWORD` no `.env.prod`, o sistema cria o dono
  (Super Admin) na primeira subida; depois entre, troque a senha em Configurações e cadastre a equipe em Equipe.
  Nunca rode o seed em produção: ele apaga tudo e cria dados de exemplo.

> **Guarde a `ENCRYPTION_KEY` fora do servidor.** Sem ela os CPFs criptografados não podem ser lidos, nem em uma restauração.

## 2. Monitoramento

- `GET /api/health` responde `{ status, db, redis, version }` e é usado pelo `HEALTHCHECK` do Docker.
- **Vigia (`watchdog`)**: sobe junto no `docker-compose.prod.yml` e consulta o health a cada 60 s. Depois de 3 falhas
  seguidas manda e-mail para `ALERT_EMAIL` (ou `OWNER_EMAIL`) e outro quando o servidor volta. Precisa de `SMTP_URL`.
  Como roda na mesma máquina, se a máquina inteira cair ele cai junto: para esse caso cadastre também a URL do health
  num monitor externo gratuito (UptimeRobot, Better Stack).
- **Alertas internos**: falha do backup semanal, do envio para a nuvem, da rotina das 00:00 ou do WhatsApp das 09:00
  gera notificação no app e e-mail para `ALERT_EMAIL` e para os e-mails do backup.
- Logs: `docker compose -f docker-compose.prod.yml logs -f app`.
- O backup em Excel sai toda segunda 08:00 e aparece em Configurações > Backup. Se o e-mail estiver configurado, chega na caixa de entrada; a falta dele é o sinal de que algo parou.

### Backup na nuvem (fora do servidor)
1. Crie um bucket privado (ex.: Cloudflare R2, que não cobra saída de dados, ou Amazon S3 em `sa-east-1`).
2. Crie uma chave de acesso só com permissão de escrita nesse bucket.
3. Em Configurações > Backup > Backup na nuvem: endereço (R2: `https://<conta>.r2.cloudflarestorage.com`, região `auto`;
   S3: `https://s3.sa-east-1.amazonaws.com`, região `sa-east-1`), bucket, chaves e uma **senha do backup na nuvem**.
   Guarde essa senha fora do servidor: sem ela os arquivos não abrem.
4. "Testar conexão" e depois "Enviar agora". Daí em diante roda sozinho às 03:00.
5. Para restaurar: baixe o `.lcbak` de `<pasta>/backups/` e use Configurações > Backup > Restaurar (pede a senha).
   Fotos e comprovantes ficam em `<pasta>/arquivos/<id>.lcbak`, criptografados com a mesma senha.
6. Configure no bucket uma regra de ciclo de vida (ex.: apagar backups com mais de 90 dias).

## 3. App Android / iPhone (EAS)

```bash
cd apps/app
npm i -g eas-cli && eas login          # conta Expo do dono
# troque SEU-DOMINIO em eas.json pelo domínio real
eas build -p android --profile preview # APK para instalar direto nos celulares da equipe
eas build -p android --profile production   # AAB para a Play Store
eas build -p ios --profile production       # requer conta Apple Developer
```

A publicação nas lojas usa as contas do dono (Google Play / Apple) e não é feita automaticamente.

## 4. E-mail e WhatsApp

- **E-mail do backup**: `SMTP_URL` no `.env.prod`. Com Gmail: ative a verificação em duas etapas, crie uma "senha de app" e use
  `smtps://seuemail%40gmail.com:SENHA-DE-APP@smtp.gmail.com:465`. Depois, em Configurações > Backup, informe o e-mail e use "Testar envio agora".
- **WhatsApp**: em Configurações > WhatsApp escolha Evolution API (URL, instância e API key) ou Meta Cloud API (Phone Number ID e token).
  Sem provedor, o sistema gera links wa.me para o funcionário enviar.
