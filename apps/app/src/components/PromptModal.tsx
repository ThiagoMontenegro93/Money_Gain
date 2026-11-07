import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { errorMessage } from '../api/http';
import { colors } from '../theme';
import { biometricCheck } from '../utils/biometric';
import { Button, InlineError, Input, Modal, ModalTone } from './ui';

/** Modal genérico para pedir senha e/ou motivo (aprovar, rejeitar, desbloquear). */
export function PromptModal({
  visible,
  title,
  description,
  askPassword,
  askReason,
  reasonLabel = 'Motivo',
  confirmLabel = 'Confirmar',
  confirmVariant = 'primary',
  tone = 'default',
  biometric,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  description?: React.ReactNode;
  askPassword?: boolean;
  askReason?: boolean;
  reasonLabel?: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'success' | 'danger' | 'warning';
  tone?: ModalTone;
  biometric?: boolean;
  onClose: () => void;
  onConfirm: (v: { password: string; reason: string }) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setPassword('');
      setReason('');
      setErr(null);
    }
  }, [visible]);

  const submit = async () => {
    if (askPassword && !password) return setErr('Informe sua senha');
    if (askReason && reason.trim().length < 3) return setErr(`Informe o ${reasonLabel.toLowerCase()}`);
    setErr(null);
    if (biometric) {
      const b = await biometricCheck('Confirme sua identidade para aprovar');
      if (!b.ok) return setErr('Verificação biométrica cancelada ou falhou');
    }
    setBusy(true);
    try {
      await onConfirm({ password, reason: reason.trim() });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={title}
      tone={tone}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button title="Cancelar" variant="secondary" onPress={onClose} />
          <Button testID="prompt-confirm" title={confirmLabel} variant={confirmVariant} loading={busy} onPress={submit} />
        </>
      }
    >
      {description ? typeof description === 'string' ? <Text style={{ color: colors.text, fontSize: 15, marginBottom: 14, fontWeight: '600' }}>{description}</Text> : description : null}
      {askReason && <Input testID="prompt-reason" label={reasonLabel} required value={reason} onChangeText={setReason} multiline rows={3} placeholder="Descreva o motivo" />}
      {askPassword && (
        <Input testID="prompt-password" label="Sua senha" required secure value={password} onChangeText={setPassword} placeholder="Digite sua senha para confirmar" onSubmitEditing={submit} autoCapitalize="none" />
      )}
      {biometric ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>🔒 No celular, a biometria do aparelho é solicitada antes de enviar.</Text> : null}
      <InlineError message={err} />
    </Modal>
  );
}
