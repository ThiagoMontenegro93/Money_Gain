-- Garante no máximo 1 recibo AGUARDANDO_APROVACAO por empréstimo (concorrência / duplo clique)
CREATE UNIQUE INDEX "Payment_one_pending_per_loan" ON "Payment"("loanId") WHERE "status" = 'AGUARDANDO_APROVACAO';
