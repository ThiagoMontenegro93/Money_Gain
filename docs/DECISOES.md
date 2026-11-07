# Decisões e premissas (Fase 1)

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
