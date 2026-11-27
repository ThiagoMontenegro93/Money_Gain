import React from 'react';
import { Text, View } from 'react-native';
import { prefetchForOffline, usePrefetch } from '../offline/prefetch';
import { useNetState } from '../offline/state';
import { colors } from '../theme';
import { dateTimeBR } from '../utils/format';
import { useToast } from './Toast';
import { Button, Card } from './ui';

/** Status e botão "Baixar agora" dos dados guardados no aparelho para usar sem internet. */
export function OfflineDataStatus() {
  const p = usePrefetch();
  const net = useNetState();
  const toast = useToast();
  return (
    <View style={{ gap: 8 }} testID="offline-data">
      <Text testID="offline-data-status" style={{ color: colors.textMuted, fontWeight: '600' }}>
        {p.running
          ? `🔄 Baixando dados para usar sem internet... ${p.total ? `${p.done}/${p.total}` : ''}`
          : p.lastAt
            ? `✅ Clientes, parcelas e empréstimos guardados no aparelho em ${dateTimeBR(new Date(p.lastAt).toISOString())}. Atualiza sozinho a cada 30 minutos com internet.`
            : '⬇️ Os dados ainda não foram baixados para este aparelho.'}
      </Text>
      <Button
        testID="offline-data-refresh"
        size="sm"
        variant="secondary"
        icon="⬇️"
        title="Baixar agora"
        loading={p.running}
        disabled={net.offline}
        style={{ alignSelf: 'flex-start' }}
        onPress={async () => {
          const ok = await prefetchForOffline(true);
          toast(ok ? 'Dados guardados no aparelho para usar sem internet' : 'Não consegui baixar agora. Verifique a internet.', ok ? 'success' : 'error');
        }}
      />
    </View>
  );
}

export function OfflineDataCard() {
  return (
    <Card title="📴 Uso sem internet" style={{ marginBottom: 12 }} testID="offline-data-card">
      <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
        Sem internet você continua vendo clientes, parcelas e empréstimos, e pode lançar recibos, clientes novos, tentativas de cobrança, comprovantes e novos empréstimos. Tudo fica salvo no aparelho e sobe sozinho quando a conexão volta.
      </Text>
      <OfflineDataStatus />
    </Card>
  );
}
