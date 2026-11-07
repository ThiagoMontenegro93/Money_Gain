import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ClientFormScreen } from '@/screens/ClientFormScreen';

export default function EditClient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ClientFormScreen clientId={String(id)} />;
}
