# LendControl Pro V6.5

Controle de empréstimos pessoais com **re-empréstimo via funcionários**: o dono (Super Admin) repassa capital
aos funcionários, que emprestam para clientes finais, lançam os recibos, e o dono/gestor aprova. O principal
volta para o funcionário re-emprestar (modo revolving) e os juros são repassados ao dono, com comissão automática.

## Estrutura

```
packages/core   Domínio puro em TypeScript (sem dependências): motor de empréstimos com projeção automática,
                multa diária, Tabela Price, score BOM/REGULAR/RUIM/PERDA, trava de crédito, fidelização,
                estratégias de cobrança, importador WhatsApp, validadores (CPF, telefone, CEP).
apps/api        NestJS 11 + Prisma 6 + PostgreSQL 16. Autenticação JWT, papéis, aprovação com senha,
                carteiras e repasses, razão de caixa, arquivos privados com URL assinada (5 min),
                CPF criptografado (AES-256-GCM), auditoria (LGPD), rotina diária 00:00.
apps/app        Expo SDK 54 + expo-router (Android, iOS e Web no mesmo código), desktop-first na web.
docs/API.md     Contrato da API.
```

## Como rodar (desenvolvimento)

Pré-requisitos: Node 20+, pnpm 10, Docker (ou PostgreSQL 16 local).

```bash
pnpm install
docker compose up -d                 # PostgreSQL em localhost:5432 (lend/lend) e Redis em 6379
cp apps/api/.env.example apps/api/.env   # TROQUE JWT_SECRET, ENCRYPTION_KEY e FILE_SIGNING_SECRET em produção
pnpm build:core
cd apps/api && npx prisma migrate deploy && pnpm prisma:seed && cd ../..
pnpm dev:api                         # API em http://localhost:3000/api
pnpm dev:web                         # App web em http://localhost:8081
```

Para gerar chaves seguras: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

**Usuários de teste** (senha `Lend@2026`): `thiago@lendcontrol.app` (dono / Super Admin),
`gestor@lendcontrol.app` (Admin), `carlos@lendcontrol.app` (funcionário, comissão 30%).
O seed cria 6 clientes reais de teste cobrindo BOM, REGULAR, RUIM e PERDA.

### Mesma origem (produção web)
`pnpm --filter @lendcontrol/app build:web` gera `apps/app/dist`; a API serve esse build em `/` e a API em `/api`
(variável `WEB_DIST_DIR` para outro caminho). Os dados ficam no PostgreSQL, não no navegador.

## Testes

```bash
pnpm --filter @lendcontrol/core test   # 38 testes do motor, score, importador e mensagens
pnpm --filter @lendcontrol/api test    # reaplica o seed e roda 42 testes ponta a ponta contra a API rodando (inclui um mock da Evolution API na porta 3999)
# Com a API servindo o build web em http://localhost:3000:
pnpm --filter @lendcontrol/app test:responsive  # 13 telas × 4 larguras (1440, 1280, 768, 390) × 2 perfis: sem estouro horizontal, sem erro de console
pnpm --filter @lendcontrol/app test:flow        # fluxo real: funcionário no celular importa WhatsApp → cadastra → empresta → lança recibo; dono aprova no desktop
```
Screenshots das telas e dos fluxos ficam em `docs/screenshots/`.

> Campos de valor (R$) usam máscara estilo caixa: os dígitos entram como centavos (digitar `100000` mostra `R$ 1.000,00`).

## Regras de negócio implementadas (Fase 1)

- **Projeção automática** (juros): R$1.000 em 30/10 a 10% → parcela 1 em 30/11 de R$1.100 (quitação prevista)
  + 3 projeções de R$100. Pagar só juros mantém o principal, a próxima parcela vira a quitação prevista e é criada
  uma nova projeção no fim (sempre 3 à frente). Quitar cancela as projeções: "Quitado em 30/12 - 3 parcelas de projeção removidas".
- **Multa diária**: `ValorAtual = Parcela × (1 + %multa × dias de atraso)`; atualizada pelo cron 00:00 (America/Sao_Paulo) e calculada na data do pagamento.
- **Simular quitação**: vencidas com multa + saldo; se nada venceu, principal + juros do período corrente.
- **Aprovação (V4)**: o recibo do funcionário (com comprovante PIX obrigatório) fica `AGUARDANDO_APROVACAO`; nada é baixado até
  o Admin aprovar com senha. Quem lançou não aprova o próprio recibo (exceto o dono). A aprovação refaz o cálculo, baixa
  parcelas, gera as projeções, lança o razão, a comissão e recalcula o score — tudo numa transação com trava do empréstimo.
- **Carteira / re-empréstimo**: repasse de capital do dono, trava de saldo ao emprestar, principal volta para o funcionário
  (revolving), juros + multa vão para "Para repassar p/ dono", comissão (% configurável) vai para "Comissão a pagar";
  repasse do funcionário para o dono com aprovação; pagamento de comissão pelo dono.
- **Score 0-10**: base 5; +2 por parcela em dia, −1 (1-7 dias), −2 (8-30), −3 (>30); teto pela taxa de pontualidade
  (ex.: 75% em dia → máximo 7). BOM 8-10, REGULAR 5-7, RUIM 0-4. **PERDA** = mais de 180 dias sem pagar com parcela vencida
  (score 0, bloqueio automático, aviso ao Super Admin, empréstimos marcados como PERDA). Ao voltar a pagar, o bloqueio automático sai.
- **Trava de crédito**: RUIM pede confirmação de risco; PERDA bloqueia — só o Super Admin desbloqueia, com senha e motivo.
- **Fidelização (BOM)**: sugestão de +50% no limite e −20% na taxa, com histórico "Desconto fidelidade aplicado por…".
- **Cobrança (RUIM/PERDA)**: estratégias (emergência, fiador, visita, desconto 10%, parcelamento 3x, carta, negativação,
  acordo 30%, jurídico) e registro das tentativas.

Decisões em que interpretei a especificação estão em `docs/DECISOES.md`.

## Fase 2 (entregue)

- **WhatsApp automático**: varredura diária às 09:00 gera D-2, D0, D+1, D+3, D+7 (e aviso ao fiador) e "Pagamento OK"
  na aprovação; fila BullMQ com 3 tentativas; janela 08–20h; blacklist e opt-out por cliente; templates editáveis;
  Evolution API, Meta Cloud API ou só link wa.me.
- **Documentos (aba 5)**: galeria com validade, verificado/pendente/vencido, marca d'água ao visualizar e log LGPD.
- **Comprovantes enviados pelo cliente**: anexados e vinculados automaticamente ao pagamento pendente; conferência pelo admin.
- **Cobrança**: mensagem firme e aviso ao fiador por wa.me, carta de cobrança e dossiê jurídico em PDF, negativação.
- **Perfil**: chave PIX do credor usada nas mensagens; edição de usuários pelo dono.

## Roadmap

- **Fase 3**: backup semanal em Excel (7 abas, fórmulas BANE, 500 linhas com 6 clientes reais), histórico dos 10 últimos,
  restauração validada com senha, envio por e-mail configurável, exportação criptografada.
- **Fase 4**: offline-first no app (fila de sincronização), builds EAS (APK/IPA), deploy (Docker + Postgres gerenciado),
  monitoramento e backups do banco.
