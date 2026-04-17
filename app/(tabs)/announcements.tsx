import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, Modal, StyleSheet,
  ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { useThemeColor } from '@/hooks/use-theme-color';
import { supabase } from '@/lib/supabase';
import type { Announcement, AnnouncementCategory } from '@/types/pantry';

const CATEGORY_PRIORITY: Record<AnnouncementCategory, number> = {
  urgent: 0, hours_change: 1, event: 2, general: 3,
};

function catColor(category: string): string {
  switch (category) {
    case 'urgent': return '#EF4444';
    case 'hours_change': return '#F59E0B';
    case 'event': return '#8B5CF6';
    default: return '#6B7280';
  }
}

function catLabel(category: string): string {
  if (category === 'hours_change') return 'Hours Change';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

type FilterType = AnnouncementCategory | 'all';

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'urgent', label: 'Urgent' },
  { key: 'hours_change', label: 'Hours Change' },
  { key: 'event', label: 'Event' },
  { key: 'general', label: 'General' },
];

export default function AnnouncementsScreen() {
  const insets = useSafeAreaInsets();
  const bg = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'icon');
  const cardBg = useThemeColor({ light: '#F9FAFB', dark: '#1F2937' }, 'background');
  const borderColor = useThemeColor({ light: '#E5E7EB', dark: '#374151' }, 'background');

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [pantryNames, setPantryNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedAnn, setSelectedAnn] = useState<Announcement | null>(null);

  async function fetchData() {
    const [{ data: annData }, { data: pantryData }] = await Promise.all([
      supabase.from('announcements').select('*').order('created_at', { ascending: false }),
      supabase.from('pantry_main').select('pantry_id, name'),
    ]);
    setAnnouncements(annData ?? []);
    setPantryNames(Object.fromEntries((pantryData ?? []).map((p) => [String(p.pantry_id), p.name])));
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  useFocusEffect(useCallback(() => { fetchData(); }, []));

  useEffect(() => {
    const channel = supabase
      .channel('announcements-tab')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const activeAnnouncements = useMemo(() => {
    const now = new Date();
    return announcements.filter((a) => {
      const isLive = a.published || (a.scheduled_for != null && new Date(a.scheduled_for) <= now);
      const notExpired = !a.expires_at || new Date(a.expires_at) > now;
      return isLive && notExpired;
    });
  }, [announcements]);

  const displayed = useMemo(() => {
    const items = filter === 'all'
      ? [...activeAnnouncements]
      : activeAnnouncements.filter((a) => a.category === filter);
    return items.sort((a, b) => {
      const pd = (CATEGORY_PRIORITY[a.category] ?? 3) - (CATEGORY_PRIORITY[b.category] ?? 3);
      return pd !== 0 ? pd : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [activeAnnouncements, filter]);

  function getPantryName(pantry_id: string | null): string {
    if (!pantry_id) return 'All Pantries';
    return pantryNames[pantry_id] ?? 'Unknown Pantry';
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: borderColor }]}>
        <Text style={[styles.headerTitle, { color: textColor }]}>Notifications</Text>
        {activeAnnouncements.length > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{activeAnnouncements.length}</Text>
          </View>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterBar, { borderBottomColor: borderColor }]}
        contentContainerStyle={styles.filterBarContent}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const color = f.key === 'all' ? '#2563EB' : catColor(f.key);
          return (
            <Pressable
              key={f.key}
              style={[
                styles.filterChip,
                {
                  borderColor: active ? color : borderColor,
                  backgroundColor: active ? color + '18' : 'transparent',
                },
              ]}
              onPress={() => setFilter(f.key)}>
              <Text style={[styles.filterChipText, { color: active ? color : mutedColor }]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={(a) => a.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 16 }]}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={[styles.emptyTitle, { color: textColor }]}>No notifications</Text>
              <Text style={[styles.emptySubtitle, { color: mutedColor }]}>
                {filter === 'all'
                  ? 'There are no active announcements right now.'
                  : `No active ${catLabel(filter).toLowerCase()} announcements.`}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const color = catColor(item.category);
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: cardBg, borderColor, opacity: pressed ? 0.75 : 1 },
                ]}
                onPress={() => setSelectedAnn(item)}>
                <View style={[styles.cardBar, { backgroundColor: color }]} />
                <View style={styles.cardContent}>
                  <View style={styles.cardTopRow}>
                    <View style={[styles.catBadge, { backgroundColor: color + '20' }]}>
                      <Text style={[styles.catBadgeText, { color }]}>{catLabel(item.category)}</Text>
                    </View>
                    <Text style={[styles.cardTime, { color: mutedColor }]}>{timeAgo(item.created_at)}</Text>
                  </View>
                  <Text style={[styles.cardTitle, { color: textColor }]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={[styles.cardPantry, { color: mutedColor }]}>
                    {getPantryName(item.pantry_id)}
                  </Text>
                  {item.body ? (
                    <Text style={[styles.cardBody, { color: mutedColor }]} numberOfLines={2}>
                      {item.body}
                    </Text>
                  ) : null}
                  {item.expires_at && (
                    <Text style={[styles.cardExpires, { color: mutedColor }]}>
                      Expires {new Date(item.expires_at).toLocaleDateString()}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Modal
        visible={selectedAnn !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedAnn(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedAnn(null)}>
          {selectedAnn && (
            <Pressable
              style={[styles.modalCard, { backgroundColor: bg }]}
              onPress={(e) => e.stopPropagation()}>
              <View style={[styles.catBadge, { backgroundColor: catColor(selectedAnn.category) + '20', marginBottom: 12 }]}>
                <Text style={[styles.catBadgeText, { color: catColor(selectedAnn.category) }]}>
                  {catLabel(selectedAnn.category)}
                </Text>
              </View>
              <Text style={[styles.modalTitle, { color: textColor }]}>{selectedAnn.title}</Text>
              <Text style={[styles.modalPantry, { color: mutedColor }]}>
                {getPantryName(selectedAnn.pantry_id)}
              </Text>
              <View style={[styles.modalDivider, { backgroundColor: mutedColor + '30' }]} />
              <Text style={[styles.modalBody, { color: textColor }]}>{selectedAnn.body}</Text>
              {selectedAnn.expires_at && (
                <Text style={[styles.modalExpires, { color: mutedColor }]}>
                  Expires: {new Date(selectedAnn.expires_at).toLocaleString()}
                </Text>
              )}
              <Pressable style={styles.modalCloseBtn} onPress={() => setSelectedAnn(null)}>
                <Text style={styles.modalCloseBtnText}>Close</Text>
              </Pressable>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 24, fontWeight: '700' },
  countBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  filterBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
  },
  filterBarContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 13, fontWeight: '600' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16 },
  emptyState: {
    paddingTop: 80,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 32,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  cardBar: { width: 4 },
  cardContent: { flex: 1, padding: 14, gap: 3 },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  catBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  catBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  cardTime: { fontSize: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardPantry: { fontSize: 12 },
  cardBody: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  cardExpires: { fontSize: 12, fontStyle: 'italic', marginTop: 2 },
  // Detail modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: 24,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16 },
      android: { elevation: 8 },
    }),
  },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  modalPantry: { fontSize: 14, marginTop: 4 },
  modalDivider: { height: 1, marginVertical: 16 },
  modalBody: { fontSize: 15, lineHeight: 22 },
  modalExpires: { fontSize: 13, marginTop: 12, fontStyle: 'italic' },
  modalCloseBtn: {
    marginTop: 20,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCloseBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
