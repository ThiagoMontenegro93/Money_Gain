import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import type { NotificationDTO } from '../api/types';
import { ROLE_LABEL, useAuth } from '../auth/AuthContext';
import { useLayout } from '../hooks/useLayout';
import { colors } from '../theme';
import { dateTimeBR } from '../utils/format';
import { OfflineBar } from './OfflineBar';
import { Button, Empty, Modal } from './ui';

interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: string;
  match: (p: string) => boolean;
}

function useNav(): NavItem[] {
  const { user } = useAuth();
  const op = user?.role === 'OPERATOR';
  return [
    { href: '/', label: 'Dashboard', short: 'Início', icon: '📊', match: (p) => p === '/' },
    { href: '/clients', label: 'Clientes', short: 'Clientes', icon: '👥', match: (p) => p.startsWith('/clients') },
    { href: '/loans', label: 'Empréstimos', short: 'Empréstimos', icon: '💰', match: (p) => p.startsWith('/loans') },
    { href: '/approvals', label: op ? 'Meus Lançamentos' : 'Aprovações', short: op ? 'Lançamentos' : 'Aprovações', icon: '✅', match: (p) => p.startsWith('/approvals') },
    { href: '/team', label: op ? 'Minha Carteira' : 'Equipe / Carteira', short: op ? 'Carteira' : 'Equipe', icon: '🧑‍💼', match: (p) => p.startsWith('/team') },
    { href: '/settings', label: 'Configurações', short: 'Config.', icon: '⚙️', match: (p) => p.startsWith('/settings') },
  ];
}

function useShortcuts() {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as any).document;
    if (!doc) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'n') {
        e.preventDefault();
        router.push('/clients/new');
      } else if (k === 'e') {
        e.preventDefault();
        router.push('/loans/new');
      }
    };
    doc.addEventListener('keydown', handler);
    return () => doc.removeEventListener('keydown', handler);
  }, [router]);
}

function Notifications() {
  const [list, setList] = useState<NotificationDTO[]>([]);
  const [open, setOpen] = useState(false);
  const load = () => api.notifications.list().then(setList).catch(() => {});
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  const unread = list.filter((n) => !n.readAt).length;
  return (
    <>
      <Pressable testID="notifications" onPress={() => setOpen(true)} style={styles.bell}>
        <Text style={{ fontSize: 18 }}>🔔</Text>
        {unread > 0 ? (
          <View style={styles.bellBadge}>
            <Text style={styles.bellBadgeText}>{unread}</Text>
          </View>
        ) : null}
      </Pressable>
      <Modal visible={open} title="Notificações" onClose={() => setOpen(false)} width={560}>
        {list.length === 0 ? <Empty text="Nenhuma notificação" icon="🔕" /> : null}
        {list.map((n) => (
          <Pressable
            key={n.id}
            onPress={async () => {
              if (n.readAt) return;
              await api.notifications.read(n.id).catch(() => {});
              void load();
            }}
            style={[styles.notif, !n.readAt && { borderLeftColor: colors.primary }]}
          >
            <Text style={{ color: colors.text, fontWeight: '800' }}>{n.title}</Text>
            <Text style={{ color: colors.textMuted, marginTop: 2 }}>{n.message}</Text>
            <Text style={{ color: colors.textDim, fontSize: 11, marginTop: 4 }}>
              {dateTimeBR(n.createdAt)} {n.readAt ? '· lida' : '· toque para marcar como lida'}
            </Text>
          </Pressable>
        ))}
      </Modal>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isDesktop } = useLayout();
  const nav = useNav();
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  useShortcuts();

  if (isDesktop) {
    return (
      <View style={styles.root}>
        <View style={styles.sidebar}>
          <View style={styles.brand}>
            <Text style={styles.brandTitle}>LendControl</Text>
            <Text style={styles.brandSub}>PRO V6.5</Text>
          </View>
          <ScrollView style={{ flex: 1 }}>
            {nav.map((n) => {
              const on = n.match(pathname);
              return (
                <Pressable key={n.href} testID={`nav-${n.href}`} onPress={() => router.push(n.href as never)} style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.navItem, on && styles.navOn, hovered && !on && { backgroundColor: colors.surface2 }]}>
                  <Text style={styles.navIcon}>{n.icon}</Text>
                  <Text style={[styles.navLabel, on && { color: '#FFFFFF' }]}>{n.label}</Text>
                </Pressable>
              );
            })}
            <View style={styles.quick}>
              <Text style={styles.quickTitle}>AÇÕES RÁPIDAS</Text>
              <Button title="Novo Cliente" icon="➕" size="sm" variant="secondary" onPress={() => router.push('/clients/new')} />
              <Button title="Novo Empréstimo" icon="💸" size="sm" variant="secondary" onPress={() => router.push('/loans/new')} />
              <Text style={styles.kbd}>Ctrl+N novo cliente · Ctrl+E novo empréstimo{'\n'}(ou Alt+N / Alt+E)</Text>
            </View>
          </ScrollView>
          <View style={styles.userBox}>
            <Text style={styles.userName} numberOfLines={1}>{user?.name}</Text>
            <Text style={styles.userRole}>{user ? ROLE_LABEL[user.role] : ''}</Text>
            <Button title="Sair" size="sm" variant="ghost" onPress={() => void logout()} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.header}>
            <View style={styles.modeBadge}>
              <Text style={styles.modeText}>🖥️ Modo Computador - Gestão Completa</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Notifications />
              <Text style={{ color: colors.textMuted, fontWeight: '600' }}>{user?.email}</Text>
            </View>
          </View>
          <OfflineBar />
          <View style={{ flex: 1 }}>{children}</View>
        </View>
      </View>
    );
  }

  const tabs = nav.filter((n) => n.href !== '/settings');
  return (
    <View style={[styles.root, { flexDirection: 'column' }]}>
      <View style={[styles.mHeader, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.brandTitle}>LendControl <Text style={{ color: colors.primary }}>PRO</Text></Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Notifications />
          <Pressable onPress={() => router.push('/settings')}>
            <Text style={{ fontSize: 20 }}>⚙️</Text>
          </Pressable>
        </View>
      </View>
      <OfflineBar />
      <View style={{ flex: 1 }}>{children}</View>
      <View style={[styles.tabbar, { paddingBottom: insets.bottom + 4 }]}>
        {tabs.map((n) => {
          const on = n.match(pathname);
          return (
            <Pressable key={n.href} testID={`tab-${n.href}`} onPress={() => router.push(n.href as never)} style={styles.tabItem}>
              <Text style={{ fontSize: 20, opacity: on ? 1 : 0.6 }}>{n.icon}</Text>
              <Text style={[styles.tabLabel, on && { color: colors.primary }]} numberOfLines={1}>{n.short}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  sidebar: { width: 260, backgroundColor: '#020617', borderRightWidth: 1, borderRightColor: colors.border, paddingTop: 18 },
  brand: { paddingHorizontal: 20, marginBottom: 18 },
  brandTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
  brandSub: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 20, marginHorizontal: 10, borderRadius: 10, marginBottom: 2 },
  navOn: { backgroundColor: colors.primaryDark },
  navIcon: { fontSize: 18, width: 24 },
  navLabel: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
  quick: { marginTop: 20, paddingHorizontal: 20, gap: 8 },
  quickTitle: { color: colors.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  kbd: { color: colors.textDim, fontSize: 11, marginTop: 4 },
  userBox: { borderTopWidth: 1, borderTopColor: colors.border, padding: 16 },
  userName: { color: colors.text, fontWeight: '800', fontSize: 14 },
  userRole: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  modeBadge: { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: colors.primary, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  modeText: { color: '#BFDBFE', fontWeight: '800', fontSize: 13 },
  bell: { padding: 6 },
  bellBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: colors.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  bellBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  notif: { borderLeftWidth: 3, borderLeftColor: 'transparent', backgroundColor: colors.bg, padding: 12, borderRadius: 8, marginBottom: 8 },
  mHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, backgroundColor: '#020617', borderBottomWidth: 1, borderBottomColor: colors.border },
  tabbar: { flexDirection: 'row', backgroundColor: '#020617', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
  tabLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
});
