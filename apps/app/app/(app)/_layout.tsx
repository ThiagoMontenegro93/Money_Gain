import React from 'react';
import { Redirect, Slot } from 'expo-router';
import { useAuth } from '@/auth/AuthContext';
import { AppShell } from '@/components/AppShell';
import { Loading } from '@/components/ui';

export default function AppLayout() {
  const { user, loading } = useAuth();
  if (loading) return <Loading text="Abrindo LendControl..." />;
  if (!user) return <Redirect href="/login" />;
  return (
    <AppShell>
      <Slot />
    </AppShell>
  );
}
