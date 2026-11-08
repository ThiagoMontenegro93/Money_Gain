# Decisões e premissas (Fases 1, 2 e 3)

Pontos em que a especificação deixava margem e a escolha feita:

1. **Valores em centavos** no motor e na API (`*Cents`), `Decimal(14,2)` no banco: evita erro de ponto flutuante.
2. **Taxa por período do método**: 10% no MENSAL = 10% ao mês; 5% no SEMANAL = 5% por semana.
3. **Vencimentos mensais ancorados no dia da liberação**: 30/10 → 30/11, 30/12, 30/01, 28/02, 30/03 (limita ao fim do mês).
4. **Principal migra na projeção**: depois de pagar só juros, a próxima parcela passa a ser a "quitação prevista"
   (principal + juros). A timeline sempre mostra quanto custa quitar na próxima data.
5. **Ordem de pagamento**: juros/parcela só na primeira parcela em aberto. Quitação cobre todas as vencidas (com multa)
   e a atual; as demais são canceladas.
6. **Quitação antecipada** cobra os juros do período corrente inteiro (sem pró-rata).
7. **Multa sobre a parcela inteira** (na quitação prevista, sobre principal + juros), conforme a fórmula da especificação;
   no pagamento "só juros" em atraso, a multa incide sobre os juros.
8. **Valor acima do devido** é aceito e lançado como receita de juros (extra); valor abaixo é recusado (use amortização).
9. **Amortização** só sem parcelas vencidas; recalcula os juros das parcelas em aberto (ou refaz a Price no prazo restante).
10. **Score**: base 5 para cliente sem histórico; parcelas vencidas em aberto também penalizam; teto pela taxa de
    pontualidade para que "BOM" signifique constância. A classe **PERDA** fica reservada para o critério de 6 meses
    (180 dias) sem pagamento; score 0-1 sem esse critério aparece como RUIM com score baixo.
11. **Comissão**: % do funcionário sobre juros + multa recebidos. Todo juro recebido vai para "Para repassar p/ dono"
    e a comissão vira "Comissão a pagar" (o dono paga via PAGAMENTO_COMISSAO). Modo não-revolving manda também o principal para o dono.
12. **Aprovação**: o Super Admin pode aprovar o próprio lançamento (é o dono); Admin e operador não.
13. **Comprovante PIX** obrigatório para lançamentos do funcionário; opcional para admin/dono.
14. **Biometria**: no celular a biometria é uma verificação extra antes de enviar a senha; o servidor sempre exige a senha
    (biometria não pode ser verificada pelo servidor).
15. **Arquivos** ficam em disco privado (`STORAGE_DIR`) com URL assinada HMAC de 5 minutos e log de visualização;
    em produção, trocar por S3/R2 com URL pré-assinada.

## Fase 2
16. **Fila**: BullMQ sobre Redis (`REDIS_URL`). Sem Redis, a API processa as mensagens em memória (bom para desenvolvimento,
    sem persistência de fila). O registro de cada mensagem fica sempre no PostgreSQL (`MessageLog`).
17. **Provedor**: Evolution API v2 (`/message/sendText/{instância}`, header `apikey`) ou Meta Cloud API. O modo `LINK`
    não envia nada: gera o link wa.me para o funcionário enviar pelo próprio WhatsApp. Z-API pode entrar como provedor novo no mesmo ponto.
18. **Chaves do provedor** ficam criptografadas (AES-256-GCM) no banco e nunca voltam nas respostas.
19. **Mensagem firme e aviso ao fiador** são manuais (botão gera o wa.me e registra a tentativa de cobrança); as automáticas
    respeitam blacklist e o opt-out do cliente.
20. **Marca d'água** é aplicada na hora de ver (o original fica intacto), com o nome de quem visualizou e a data;
    cada visualização é registrada.
21. **Biometria** segue a decisão 14: o app pede biometria quando disponível e o servidor sempre confere a senha.

## Fase 3
22. **Planilha gerada no servidor** (ExcelJS), não no navegador: o backup automático de segunda 08:00 roda sem ninguém
    com o app aberto, e os dados vêm do banco (não do armazenamento do navegador).
23. **Restauração sem perda**: as 7 abas são para leitura e para tocar o negócio na planilha; a restauração usa uma aba
    oculta `_DADOS` com o banco completo (compactado, com SHA-256). Edições à mão nas abas não são importadas, exceto
    **pagamentos novos na aba 4 sem "ID sistema"**: entram como recibos aguardando aprovação (nada é baixado sem aprovação).
24. Antes de restaurar, o sistema gera sozinho um backup do estado atual ("antes-da-restauracao"). A trilha de auditoria
    atual é mantida. Arquivos (fotos/comprovantes) ficam no disco do servidor e não vão na planilha.
25. A planilha tem **CPF completo** (pedido da spec para tocar o negócio). Por isso o envio por e-mail avisa que contém
    dados pessoais, e há a exportação criptografada `.lcbak` com senha.
26. **E-mail** por SMTP (`SMTP_URL`), configurado no servidor; o e-mail de destino e os adicionais ficam no banco e são
    editados em Configurações > Backup.
27. Status AUTO da planilha segue a fórmula da spec (8+ BOM, 5+ REGULAR, 2+ RUIM, senão PERDA); a coluna Status traz a
    classificação do sistema (PERDA só com 180 dias sem pagar). Cores: verde, amarelo, laranja e preto.

## Fase 4
28. **Offline** cobre as ações de rua do funcionário (recibo, cobrança, cadastro novo, comprovante do cliente). Edição de
    cliente existente e documentos exigem internet. As validações do servidor rodam no envio; o que falhar aparece em
    "Envios pendentes" com o motivo.
29. **Idempotência** por cabeçalho `Idempotency-Key` (por usuário, 7 dias) nas rotas de criação usadas pela fila.
30. A fila offline sobrevive ao logout e é retomada no próximo login do mesmo usuário; o cache de leitura é apagado no logout.
31. Sem service worker: no navegador, recarregar a página sem internet não abre o app (no celular funciona).

## Opções por empréstimo (pedido de 08/11)
32. Cada empréstimo guarda se aceita amortização e se cobra multa diária por atraso; o padrão geral fica em
    Configurações > Empréstimos (só o dono altera). Desligar a multa num empréstimo já liberado (gestor/dono) recalcula
    as parcelas em aberto na hora e fica auditado; a % combinada é guardada para religar depois.
33. Sem multa, o atraso continua contando para o score e para a régua de cobrança; só o valor não aumenta.
