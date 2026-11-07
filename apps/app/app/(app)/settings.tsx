import React from 'react';
import { Text, View } from 'react-native';
import { ROLE_LABEL, useAuth } from '@/auth/AuthContext';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button, Card, KV, Notice } from '@/components/ui';
import { API_URL } from '@/config';
import { colors } from '@/theme';
import { http } from '@/api/http';

export default function Settings() {
  const { user, logout, hasRole } = useAuth();
  const toast = useToast();
  return (
    <Screen title="Configurações" maxWidth={900}>
      <Card title="Minha conta" style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 28 }}>
          <KV k="Nome" v={user?.name ?? ''} />
          <KV k="E-mail" v={user?.email ?? ''} />
          <KV k="Papel" v={user ? ROLE_LABEL[user.role] : ''} />
          <KV k="API" v={API_URL} />
        </View>
        <Button title="Sair" icon="🚪" variant="secondary" onPress={() => void logout()} style={{ alignSelf: 'flex-start' }} />
      </Card>
      {hasRole('SUPER_ADMIN') ? (
        <Card title="Rotina diária" style={{ marginBottom: 12 }}>
          <Text style={{ color: colors.textMuted, marginBottom: 10 }}>Recalcula multas, scores e classificação PERDA (normalmente roda automaticamente às 00:00).</Text>
          <Button title="Rodar rotina agora" icon="⚙️" variant="secondary" onPress={() => http.post('/jobs/daily/run').then(() => toast('Rotina executada')).catch((e) => toast(e.message, 'error'))} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}
      <Notice tone="info" text="⚙️ Configurações de e-mail, backups semanais (planilha BANE), mensagens WhatsApp pré-programadas e galeria de documentos chegam nas próximas fases." />
    </Screen>
  );
}
