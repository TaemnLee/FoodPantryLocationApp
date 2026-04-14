import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, Modal,
  StyleSheet, ScrollView, Switch, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ExpoCrypto from 'expo-crypto';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useThemeColor } from '@/hooks/use-theme-color';
import { supabase } from '@/lib/supabase';
import type { PantryLocation, Announcement, AnnouncementCategory } from '@/types/pantry';

async function geocodeAddress(street: string, city: string, state: string, zip: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('Geocoding: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set');
    return null;
  }
  const address = `${street}, ${city}, ${state} ${zip}`;
  console.log('Geocoding address:', address);
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`);
  const data = await res.json();
  console.log('Geocoding response status:', data.status, data.error_message ?? '');
  if (data.status !== 'OK' || !data.results?.[0]?.geometry?.location) return null;
  return data.results[0].geometry.location;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_ABBREV: Record<string, string> = {
  sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed',
  thursday: 'Thu', friday: 'Fri', saturday: 'Sat',
};

function getDayAbbrev(weekday: string): string {
  const w = String(weekday).toLowerCase().trim();
  if (WEEKDAY_ABBREV[w]) return WEEKDAY_ABBREV[w];
  const num = parseInt(w, 10);
  if (!isNaN(num) && num >= 0 && num <= 6) return WEEKDAY_ABBREV[WEEKDAYS[num]] ?? w;
  const match = WEEKDAYS.find((d) => d.startsWith(w.slice(0, 3)) || w.startsWith(d.slice(0, 3)));
  return match ? WEEKDAY_ABBREV[match] ?? w : w;
}

type FormHour = { weekday: string; open_time: string; close_time: string };
type PantryForm = {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  service_type: string;
  isClosed: boolean;
  hours: FormHour[];
};

const EMPTY_FORM: PantryForm = {
  name: '', street: '', city: '', state: 'OH', zip: '',
  service_type: '', isClosed: false, hours: [],
};

const ANNOUNCEMENT_CATEGORIES: { value: AnnouncementCategory; label: string; color: string }[] = [
  { value: 'urgent', label: 'Urgent', color: '#EF4444' },
  { value: 'hours_change', label: 'Hours Change', color: '#F59E0B' },
  { value: 'event', label: 'Event', color: '#8B5CF6' },
  { value: 'general', label: 'General', color: '#6B7280' },
];

type AnnStatus = 'publish_now' | 'draft' | 'schedule';

type AnnouncementForm = {
  title: string;
  body: string;
  category: AnnouncementCategory;
  pantry_id: string | null;
  expires_at: Date | null;
  status: AnnStatus;
  schedule_at: Date | null;
};

const EMPTY_ANN_FORM: AnnouncementForm = {
  title: '', body: '', category: 'general', pantry_id: null,
  expires_at: null, status: 'publish_now', schedule_at: null,
};

function formatDateTime(d: Date): string {
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours();
  const mins = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${month}/${day}/${year} ${h12}:${mins} ${ampm}`;
}

function pantryToForm(p: PantryLocation): PantryForm {
  return {
    name: p.name,
    street: p.street,
    city: p.city,
    state: p.state,
    zip: p.zip,
    service_type: p.service_type ?? '',
    isClosed: p.temporary_closure ?? false,
    hours: (p.pantry_op_hours ?? []).map((h) => ({
      weekday: h.weekday,
      open_time: h.open_time,
      close_time: h.close_time,
    })),
  };
}

export default function AdminScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const bg = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'icon');
  const borderColor = useThemeColor({ light: '#E5E7EB', dark: '#374151' }, 'background');
  const cardBg = useThemeColor({ light: '#F9FAFB', dark: '#1F2937' }, 'background');
  const inputBg = useThemeColor({ light: '#FFFFFF', dark: '#111827' }, 'background');
  const separatorColor = useThemeColor({ light: '#F3F4F6', dark: '#1F2937' }, 'background');

  const [activeTab, setActiveTab] = useState<'pantries' | 'announcements'>('pantries');

  const [pantries, setPantries] = useState<PantryLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<PantryLocation | null>(null);
  const [form, setForm] = useState<PantryForm>(EMPTY_FORM);
  const [newHour, setNewHour] = useState<FormHour>({ weekday: 'monday', open_time: '09:00', close_time: '17:00' });
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading] = useState(true);
  const [annSearchQuery, setAnnSearchQuery] = useState('');
  const [showAnnForm, setShowAnnForm] = useState(false);
  const [annEditTarget, setAnnEditTarget] = useState<Announcement | null>(null);
  const [annForm, setAnnForm] = useState<AnnouncementForm>(EMPTY_ANN_FORM);
  const [annSaving, setAnnSaving] = useState(false);
  const [showAnnDeleteConfirm, setShowAnnDeleteConfirm] = useState(false);
  const [showExpiresPicker, setShowExpiresPicker] = useState(false);
  const [expiresPickerMode, setExpiresPickerMode] = useState<'date' | 'time'>('date');
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [schedulePickerMode, setSchedulePickerMode] = useState<'date' | 'time'>('date');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace('/');
    });
  }, []);

  useEffect(() => {
    (async () => {
      const [{ data: locations, error: locError }, { data: hours, error: hoursError }, { data: mains }] = await Promise.all([
        supabase.from('pantry_location').select('*'),
        supabase.from('pantry_op_hours').select('*'),
        supabase.from('pantry_main').select('pantry_id, service_type, temporary_closure'),
      ]);
      if (locError) {
        console.error('Admin fetch error:', locError.message, locError.code);
        Alert.alert('Failed to load pantries', locError.message);
        setLoading(false);
        return;
      }
      if (hoursError) console.warn('Hours fetch error:', hoursError.message);
      const allHours = hours ?? [];
      const mainMap = Object.fromEntries((mains ?? []).map((m) => [String(m.pantry_id), m]));
      const merged = (locations ?? []).map((p) => ({
        ...p,
        service_type: mainMap[String(p.pantry_id)]?.service_type ?? '',
        temporary_closure: mainMap[String(p.pantry_id)]?.temporary_closure ?? false,
        pantry_op_hours: allHours.filter((h) => String(h.pantry_id) === String(p.pantry_id)),
      }));
      setPantries(merged);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        console.error('Announcements fetch error:', error.message);
      }
      setAnnouncements(data ?? []);
      setAnnLoading(false);
    })();
  }, []);

  const filteredAnnouncements = useMemo(() => {
    const q = annSearchQuery.trim().toLowerCase();
    if (!q) return announcements;
    return announcements.filter((a) =>
      [a.title, a.body, a.category].join(' ').toLowerCase().includes(q)
    );
  }, [announcements, annSearchQuery]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return pantries;
    return pantries.filter((p) =>
      [p.name, p.street, p.city].join(' ').toLowerCase().includes(q)
    );
  }, [pantries, searchQuery]);

  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(pantry: PantryLocation) {
    setEditTarget(pantry);
    setForm(pantryToForm(pantry));
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditTarget(null);
  }

  function addHourSlot() {
    setForm((f) => ({ ...f, hours: [...f.hours, { ...newHour }] }));
    setNewHour({ weekday: 'monday', open_time: '09:00', close_time: '17:00' });
  }

  function removeHourSlot(index: number) {
    setForm((f) => ({ ...f, hours: f.hours.filter((_, i) => i !== index) }));
  }

  async function handleDelete() {
    if (!editTarget) return;
    const id = editTarget.pantry_id;
    setSaving(true);
    try {
      await supabase.from('pantry_op_hours').delete().eq('pantry_id', id);
      await supabase.from('pantry_location').delete().eq('pantry_id', id);
      await supabase.from('pantry_main').delete().eq('pantry_id', id);
      setPantries((prev) => prev.filter((p) => p.pantry_id !== id));
      setShowDeleteConfirm(false);
      closeForm();
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) { Alert.alert('Missing field', 'Name is required.'); return; }
    setSaving(true);
    try {
      if (isAdding) {
        const coords = await geocodeAddress(form.street, form.city, form.state, form.zip);
        if (!coords) { Alert.alert('Geocoding failed', 'Could not find coordinates for this address. Check the address and try again.'); return; }
        const pantry_id = ExpoCrypto.randomUUID();
        const { error: mainErr } = await supabase.from('pantry_main').insert({
          pantry_id, name: form.name, service_type: form.service_type, temporary_closure: form.isClosed,
        });
        if (mainErr) { Alert.alert('Error', mainErr.message); return; }
        const { error: insertErr } = await supabase.from('pantry_location').insert({
          pantry_id, name: form.name, street: form.street, city: form.city,
          state: form.state, zip: form.zip, county: 'Licking',
          latitude: coords.lat, longitude: coords.lng,
        });
        if (insertErr) { Alert.alert('Error', insertErr.message); return; }
        if (form.hours.length > 0) {
          await supabase.from('pantry_op_hours').insert(
            form.hours.map((h) => ({ pantry_id, name: form.name, weekday: h.weekday, open_time: h.open_time, close_time: h.close_time }))
          );
        }
        const newPantry: PantryLocation = {
          pantry_id, name: form.name, street: form.street, city: form.city,
          state: form.state, zip: form.zip, county: 'Licking',
          service_type: form.service_type,
          latitude: coords.lat, longitude: coords.lng,
          pantry_op_hours: form.hours.map((h) => ({ ...h, pantry_id, name: form.name })),
        };
        setPantries((prev) => [...prev, newPantry]);
      } else {
        const id = editTarget!.pantry_id;
        await supabase.from('pantry_main').update({
          name: form.name, service_type: form.service_type, temporary_closure: form.isClosed,
        }).eq('pantry_id', id);
        const { error: updateErr } = await supabase.from('pantry_location').update({
          name: form.name, street: form.street, city: form.city,
          state: form.state, zip: form.zip,
        }).eq('pantry_id', id);
        if (updateErr) { Alert.alert('Error', updateErr.message); return; }
        await supabase.from('pantry_op_hours').delete().eq('pantry_id', id);
        if (form.hours.length > 0) {
          await supabase.from('pantry_op_hours').insert(
            form.hours.map((h) => ({ pantry_id: id, name: form.name, weekday: h.weekday, open_time: h.open_time, close_time: h.close_time }))
          );
        }
        setPantries((prev) => prev.map((p) =>
          p.pantry_id === id
            ? { ...p, name: form.name, street: form.street, city: form.city, state: form.state, zip: form.zip, temporary_closure: form.isClosed, pantry_op_hours: form.hours.map((h) => ({ ...h, pantry_id: id, name: form.name })) }
            : p
        ));
      }
      closeForm();
    } finally {
      setSaving(false);
    }
  }

  const isAdding = editTarget === null;
  const isAddingAnn = annEditTarget === null;

  function openAddAnn() {
    setAnnEditTarget(null);
    setAnnForm(EMPTY_ANN_FORM);
    setShowAnnForm(true);
  }

  function openEditAnn(ann: Announcement) {
    setAnnEditTarget(ann);
    const isScheduled = !!ann.scheduled_for && !ann.published;
    setAnnForm({
      title: ann.title,
      body: ann.body,
      category: ann.category,
      pantry_id: ann.pantry_id,
      expires_at: ann.expires_at ? new Date(ann.expires_at) : null,
      status: isScheduled ? 'schedule' : ann.published ? 'publish_now' : 'draft',
      schedule_at: ann.scheduled_for ? new Date(ann.scheduled_for) : null,
    });
    setShowAnnForm(true);
  }

  function closeAnnForm() {
    setShowAnnForm(false);
    setAnnEditTarget(null);
  }

  async function handleAnnSave() {
    if (!annForm.title.trim()) { Alert.alert('Missing field', 'Title is required.'); return; }
    if (!annForm.body.trim()) { Alert.alert('Missing field', 'Body is required.'); return; }
    setAnnSaving(true);
    try {
      if (annForm.status === 'schedule' && !annForm.schedule_at) {
        Alert.alert('Missing field', 'Please set a scheduled date & time.'); setAnnSaving(false); return;
      }
      const payload = {
        title: annForm.title.trim(),
        body: annForm.body.trim(),
        category: annForm.category,
        pantry_id: annForm.pantry_id || null,
        expires_at: annForm.expires_at ? annForm.expires_at.toISOString() : null,
        published: annForm.status === 'publish_now',
        scheduled_for: annForm.status === 'schedule' && annForm.schedule_at
          ? annForm.schedule_at.toISOString()
          : null,
      };
      if (isAddingAnn) {
        const { data, error } = await supabase
          .from('announcements')
          .insert({ id: ExpoCrypto.randomUUID(), ...payload })
          .select()
          .single();
        if (error) { Alert.alert('Error', error.message); return; }
        setAnnouncements((prev) => [data, ...prev]);
      } else {
        const { data, error } = await supabase
          .from('announcements')
          .update(payload)
          .eq('id', annEditTarget!.id)
          .select()
          .single();
        if (error) { Alert.alert('Error', error.message); return; }
        setAnnouncements((prev) => prev.map((a) => a.id === data.id ? data : a));
      }
      closeAnnForm();
    } finally {
      setAnnSaving(false);
    }
  }

  async function handleAnnDelete() {
    if (!annEditTarget) return;
    setAnnSaving(true);
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', annEditTarget.id);
      if (error) { Alert.alert('Error', error.message); return; }
      setAnnouncements((prev) => prev.filter((a) => a.id !== annEditTarget.id));
      setShowAnnDeleteConfirm(false);
      closeAnnForm();
    } finally {
      setAnnSaving(false);
    }
  }

  function getPantryName(pantryId: string | null): string {
    if (!pantryId) return 'All Pantries';
    return pantries.find((p) => p.pantry_id === pantryId)?.name ?? 'Unknown';
  }

  function getCategoryInfo(cat: AnnouncementCategory) {
    return ANNOUNCEMENT_CATEGORIES.find((c) => c.value === cat) ?? ANNOUNCEMENT_CATEGORIES[3];
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: borderColor }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={[styles.backBtnText, { color: '#2563EB' }]}>← Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: textColor }]}>Admin Panel</Text>
        <Pressable style={styles.signOutBtn} onPress={async () => {
          await supabase.auth.signOut();
          router.back();
        }}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>
      </View>

      {/* Tab Switcher */}
      <View style={[styles.tabBar, { borderBottomColor: borderColor }]}>
        <Pressable
          style={[styles.tab, activeTab === 'pantries' && styles.tabActive]}
          onPress={() => setActiveTab('pantries')}>
          <Text style={[styles.tabText, { color: mutedColor }, activeTab === 'pantries' && styles.tabTextActive]}>
            Pantries
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === 'announcements' && styles.tabActive]}
          onPress={() => setActiveTab('announcements')}>
          <Text style={[styles.tabText, { color: mutedColor }, activeTab === 'announcements' && styles.tabTextActive]}>
            Announcements
          </Text>
        </Pressable>
      </View>

      {activeTab === 'pantries' ? (
        <>
          {/* Search + Add */}
          <View style={[styles.toolbar, { borderBottomColor: borderColor }]}>
            <TextInput
              style={[styles.searchInput, { backgroundColor: inputBg, borderColor, color: textColor }]}
              placeholder="Search pantries…"
              placeholderTextColor={mutedColor}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            <Pressable
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
              onPress={openAdd}>
              <Text style={styles.addBtnText}>+ Add</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" />
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(p) => p.pantry_id}
              contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 16 }]}
              ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: separatorColor }]} />}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <View style={styles.rowInfo}>
                    <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.rowAddress, { color: mutedColor }]} numberOfLines={1}>
                      {item.street}, {item.city}
                    </Text>
                    <View style={styles.rowHoursRow}>
                      <Text style={[styles.rowHoursCount, { color: mutedColor }]}>
                        {item.pantry_op_hours?.length
                          ? `${item.pantry_op_hours.length} hour slot${item.pantry_op_hours.length !== 1 ? 's' : ''}`
                          : 'No hours set'}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.editBtn, { borderColor }, pressed && { opacity: 0.7 }]}
                    onPress={() => openEdit(item)}>
                    <Text style={[styles.editBtnText, { color: textColor }]}>Edit</Text>
                  </Pressable>
                </View>
              )}
            />
          )}
        </>
      ) : (
        <>
          {/* Announcements Search + Add */}
          <View style={[styles.toolbar, { borderBottomColor: borderColor }]}>
            <TextInput
              style={[styles.searchInput, { backgroundColor: inputBg, borderColor, color: textColor }]}
              placeholder="Search announcements…"
              placeholderTextColor={mutedColor}
              value={annSearchQuery}
              onChangeText={setAnnSearchQuery}
              returnKeyType="search"
            />
            <Pressable
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
              onPress={openAddAnn}>
              <Text style={styles.addBtnText}>+ Add</Text>
            </Pressable>
          </View>

          {annLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" />
            </View>
          ) : (
            <FlatList
              data={filteredAnnouncements}
              keyExtractor={(a) => a.id}
              contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 16 }]}
              ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: separatorColor }]} />}
              ListEmptyComponent={
                <Text style={[styles.emptyText, { color: mutedColor }]}>No announcements yet</Text>
              }
              renderItem={({ item }) => {
                const catInfo = getCategoryInfo(item.category);
                const isExpired = item.expires_at && new Date(item.expires_at) < new Date();
                const isScheduled = !!item.scheduled_for && !item.published;
                const isScheduledLive = isScheduled && new Date(item.scheduled_for!) <= new Date();
                const isLive = item.published || isScheduledLive;
                return (
                  <View style={styles.row}>
                    <View style={styles.rowInfo}>
                      <View style={styles.annRowHeader}>
                        <View style={[styles.annCategoryBadge, { backgroundColor: catInfo.color + '20' }]}>
                          <Text style={[styles.annCategoryBadgeText, { color: catInfo.color }]}>
                            {catInfo.label}
                          </Text>
                        </View>
                        {isLive && !isExpired && (
                          <View style={[styles.annDraftBadge, { backgroundColor: '#F0FDF4' }]}>
                            <Text style={[styles.annDraftBadgeText, { color: '#16a34a' }]}>Live</Text>
                          </View>
                        )}
                        {isScheduled && !isScheduledLive && (
                          <View style={[styles.annDraftBadge, { backgroundColor: '#EFF6FF' }]}>
                            <Text style={[styles.annDraftBadgeText, { color: '#2563EB' }]}>Scheduled</Text>
                          </View>
                        )}
                        {!isLive && !isScheduled && (
                          <View style={[styles.annDraftBadge, { backgroundColor: borderColor }]}>
                            <Text style={[styles.annDraftBadgeText, { color: mutedColor }]}>Draft</Text>
                          </View>
                        )}
                        {isExpired && (
                          <View style={[styles.annDraftBadge, { backgroundColor: '#FEF2F2' }]}>
                            <Text style={[styles.annDraftBadgeText, { color: '#EF4444' }]}>Expired</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.rowName, { color: textColor }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={[styles.rowAddress, { color: mutedColor }]} numberOfLines={1}>
                        {getPantryName(item.pantry_id)}
                        {isScheduled
                          ? ` · Publishes ${formatDateTime(new Date(item.scheduled_for!))}`
                          : item.expires_at ? ` · Expires ${formatDateTime(new Date(item.expires_at))}` : ''}
                      </Text>
                    </View>
                    <Pressable
                      style={({ pressed }) => [styles.editBtn, { borderColor }, pressed && { opacity: 0.7 }]}
                      onPress={() => openEditAnn(item)}>
                      <Text style={[styles.editBtnText, { color: textColor }]}>Edit</Text>
                    </Pressable>
                  </View>
                );
              }}
            />
          )}
        </>
      )}

      {/* Announcement Edit / Add Modal */}
      <Modal
        visible={showAnnForm}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeAnnForm}>
        <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }]} edges={['top']}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

            <View style={[styles.modalHeader, { borderBottomColor: borderColor }]}>
              <Pressable onPress={closeAnnForm}>
                <Text style={[styles.modalCancel, { color: mutedColor }]}>Cancel</Text>
              </Pressable>
              <Text style={[styles.modalTitle, { color: textColor }]}>
                {isAddingAnn ? 'New Announcement' : 'Edit Announcement'}
              </Text>
              <Pressable onPress={handleAnnSave} disabled={annSaving}>
                <Text style={[styles.modalSave, annSaving && { opacity: 0.4 }]}>
                  {annSaving ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + 32 }]}
              keyboardShouldPersistTaps="handled">

              <Text style={[styles.sectionLabel, { color: mutedColor }]}>CONTENT</Text>
              <View style={[styles.fieldGroup, { backgroundColor: cardBg, borderColor }]}>
                <FormField label="Title" value={annForm.title}
                  onChangeText={(v) => setAnnForm((f) => ({ ...f, title: v }))}
                  placeholder="Short headline"
                  textColor={textColor} mutedColor={mutedColor} />
                <View style={[styles.fieldDivider, { backgroundColor: borderColor }]} />
                <View style={styles.fieldRow}>
                  <Text style={[styles.fieldLabel, { color: mutedColor }]}>Body</Text>
                  <TextInput
                    style={[styles.fieldInput, { color: textColor, minHeight: 60 }]}
                    value={annForm.body}
                    onChangeText={(v) => setAnnForm((f) => ({ ...f, body: v }))}
                    placeholder="Full message…"
                    placeholderTextColor={mutedColor}
                    multiline
                  />
                </View>
              </View>

              <Text style={[styles.sectionLabel, { color: mutedColor }]}>CATEGORY</Text>
              <View style={[styles.fieldGroup, { backgroundColor: cardBg, borderColor }]}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.annCategoryRow}>
                  {ANNOUNCEMENT_CATEGORIES.map((cat) => {
                    const isActive = annForm.category === cat.value;
                    return (
                      <Pressable
                        key={cat.value}
                        style={[
                          styles.annCatChip,
                          { borderColor: cat.color + '40' },
                          isActive && { backgroundColor: cat.color, borderColor: cat.color },
                        ]}
                        onPress={() => setAnnForm((f) => ({ ...f, category: cat.value }))}>
                        <Text style={[
                          styles.annCatChipText,
                          { color: cat.color },
                          isActive && { color: '#FFFFFF' },
                        ]}>
                          {cat.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <Text style={[styles.sectionLabel, { color: mutedColor }]}>PANTRY (OPTIONAL)</Text>
              <View style={[styles.fieldGroup, { backgroundColor: cardBg, borderColor }]}>
                <Pressable
                  style={styles.fieldRow}
                  onPress={() => {
                    const options = [
                      { text: 'All Pantries (App-Wide)', onPress: () => setAnnForm((f) => ({ ...f, pantry_id: null })) },
                      ...pantries.map((p) => ({
                        text: p.name,
                        onPress: () => setAnnForm((f) => ({ ...f, pantry_id: p.pantry_id })),
                      })),
                    ];
                    Alert.alert('Select Pantry', 'Choose which pantry this announcement is for', [
                      ...options,
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }}>
                  <Text style={[styles.fieldLabel, { color: mutedColor }]}>Pantry</Text>
                  <Text style={[styles.fieldInput, { color: textColor }]}>
                    {getPantryName(annForm.pantry_id)}
                  </Text>
                </Pressable>
              </View>

              <Text style={[styles.sectionLabel, { color: mutedColor }]}>EXPIRATION</Text>
              <View style={[styles.fieldGroup, { backgroundColor: cardBg, borderColor }]}>
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.switchLabel, { color: textColor }]}>
                      {annForm.expires_at ? formatDateTime(annForm.expires_at) : 'No expiration'}
                    </Text>
                    <Text style={[styles.switchSub, { color: mutedColor }]}>
                      {annForm.expires_at ? 'Auto-hides after this date & time' : 'Stays until manually removed'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                      style={({ pressed }) => [styles.pickerBtn, pressed && { opacity: 0.7 }]}
                      onPress={() => {
                        if (!annForm.expires_at) {
                          const tomorrow = new Date();
                          tomorrow.setDate(tomorrow.getDate() + 1);
                          tomorrow.setHours(17, 0, 0, 0);
                          setAnnForm((f) => ({ ...f, expires_at: tomorrow }));
                        }
                        setExpiresPickerMode('date');
                        setShowExpiresPicker(true);
                      }}>
                      <Text style={styles.pickerBtnText}>
                        {annForm.expires_at ? 'Change' : 'Set'}
                      </Text>
                    </Pressable>
                    {annForm.expires_at && (
                      <Pressable
                        style={({ pressed }) => [styles.pickerClearBtn, pressed && { opacity: 0.7 }]}
                        onPress={() => setAnnForm((f) => ({ ...f, expires_at: null }))}>
                        <Text style={styles.pickerClearBtnText}>Clear</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
                {showExpiresPicker && (
                  <View style={styles.datePickerContainer}>
                    <DateTimePicker
                      value={annForm.expires_at ?? new Date()}
                      mode={expiresPickerMode}
                      display="spinner"
                      minimumDate={new Date()}
                      onChange={(_e, selectedDate) => {
                        if (selectedDate) {
                          setAnnForm((f) => ({ ...f, expires_at: selectedDate }));
                        }
                      }}
                    />
                    <View style={styles.datePickerActions}>
                      {expiresPickerMode === 'date' ? (
                        <Pressable
                          style={[styles.pickerBtn, { flex: 1 }]}
                          onPress={() => setExpiresPickerMode('time')}>
                          <Text style={styles.pickerBtnText}>Set Time →</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          style={[styles.pickerBtn, { flex: 1 }]}
                          onPress={() => setExpiresPickerMode('date')}>
                          <Text style={styles.pickerBtnText}>← Set Date</Text>
                        </Pressable>
                      )}
                      <Pressable
                        style={[styles.pickerBtn, { flex: 1, backgroundColor: '#2563EB' }]}
                        onPress={() => setShowExpiresPicker(false)}>
                        <Text style={[styles.pickerBtnText, { color: '#FFFFFF' }]}>Done</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>

              <Text style={[styles.sectionLabel, { color: mutedColor }]}>VISIBILITY</Text>
              <View style={[styles.fieldGroup, { backgroundColor: cardBg, borderColor }]}>
                {([
                  { key: 'publish_now' as AnnStatus, title: 'Publish Now', sub: 'Immediately visible to all users', color: '#16a34a' },
                  { key: 'schedule' as AnnStatus, title: 'Schedule', sub: 'Publish automatically at a set date & time', color: '#2563EB' },
                  { key: 'draft' as AnnStatus, title: 'Save as Draft', sub: 'Only visible to admins until published', color: '#F59E0B' },
                ] as const).map((opt, i) => (
                  <View key={opt.key}>
                    {i > 0 && <View style={[styles.fieldDivider, { backgroundColor: borderColor }]} />}
                    <Pressable
                      style={styles.switchRow}
                      onPress={() => {
                        setAnnForm((f) => ({ ...f, status: opt.key }));
                        if (opt.key === 'schedule' && !annForm.schedule_at) {
                          const tomorrow = new Date();
                          tomorrow.setDate(tomorrow.getDate() + 1);
                          tomorrow.setHours(9, 0, 0, 0);
                          setAnnForm((f) => ({ ...f, status: 'schedule', schedule_at: tomorrow }));
                          setSchedulePickerMode('date');
                          setShowSchedulePicker(true);
                        }
                        if (opt.key !== 'schedule') setShowSchedulePicker(false);
                      }}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.switchLabel, { color: textColor }]}>{opt.title}</Text>
                        <Text style={[styles.switchSub, { color: mutedColor }]}>{opt.sub}</Text>
                      </View>
                      <View style={[
                        styles.radioOuter,
                        { borderColor: annForm.status === opt.key ? opt.color : borderColor },
                      ]}>
                        {annForm.status === opt.key && (
                          <View style={[styles.radioInner, { backgroundColor: opt.color }]} />
                        )}
                      </View>
                    </Pressable>
                  </View>
                ))}

                {annForm.status === 'schedule' && (
                  <>
                    <View style={[styles.fieldDivider, { backgroundColor: borderColor }]} />
                    <View style={styles.switchRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.switchLabel, { color: textColor }]}>
                          {annForm.schedule_at ? formatDateTime(annForm.schedule_at) : 'Not set'}
                        </Text>
                        <Text style={[styles.switchSub, { color: mutedColor }]}>
                          Goes live at this date & time
                        </Text>
                      </View>
                      <Pressable
                        style={({ pressed }) => [styles.pickerBtn, pressed && { opacity: 0.7 }]}
                        onPress={() => {
                          setSchedulePickerMode('date');
                          setShowSchedulePicker(true);
                        }}>
                        <Text style={styles.pickerBtnText}>Change</Text>
                      </Pressable>
                    </View>
                    {showSchedulePicker && (
                      <View style={styles.datePickerContainer}>
                        <DateTimePicker
                          value={annForm.schedule_at ?? new Date()}
                          mode={schedulePickerMode}
                          display="spinner"
                          minimumDate={new Date()}
                          onChange={(_e, selectedDate) => {
                            if (selectedDate) {
                              setAnnForm((f) => ({ ...f, schedule_at: selectedDate }));
                            }
                          }}
                        />
                        <View style={styles.datePickerActions}>
                          {schedulePickerMode === 'date' ? (
                            <Pressable
                              style={[styles.pickerBtn, { flex: 1 }]}
                              onPress={() => setSchedulePickerMode('time')}>
                              <Text style={styles.pickerBtnText}>Set Time →</Text>
                            </Pressable>
                          ) : (
                            <Pressable
                              style={[styles.pickerBtn, { flex: 1 }]}
                              onPress={() => setSchedulePickerMode('date')}>
                              <Text style={styles.pickerBtnText}>← Set Date</Text>
                            </Pressable>
                          )}
                          <Pressable
                            style={[styles.pickerBtn, { flex: 1, backgroundColor: '#2563EB' }]}
                            onPress={() => setShowSchedulePicker(false)}>
                            <Text style={[styles.pickerBtnText, { color: '#FFFFFF' }]}>Done</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </>
                )}
              </View>

              {!isAddingAnn && (
                <Pressable
                  style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => setShowAnnDeleteConfirm(true)}>
                  <Text style={styles.deleteBtnText}>Delete Announcement</Text>
                </Pressable>
              )}
            </ScrollView>
          </KeyboardAvoidingView>

          {showAnnDeleteConfirm && (
            <Pressable style={styles.confirmOverlay} onPress={() => setShowAnnDeleteConfirm(false)}>
              <Pressable style={[styles.confirmCard, { backgroundColor: bg, borderColor }]} onPress={() => {}}>
                <Text style={[styles.confirmTitle, { color: textColor }]}>Delete Announcement?</Text>
                <Text style={[styles.confirmBody, { color: mutedColor }]}>
                  "{annEditTarget?.title}" will be permanently removed.
                </Text>
                <View style={[styles.confirmDivider, { backgroundColor: borderColor }]} />
                <Pressable
                  style={({ pressed }) => [styles.confirmDeleteBtn, pressed && { opacity: 0.8 }]}
                  onPress={handleAnnDelete}
                  disabled={annSaving}>
                  <Text style={styles.confirmDeleteText}>{annSaving ? 'Deleting…' : 'Delete'}</Text>
                </Pressable>
                <View style={[styles.confirmDivider, { backgroundColor: borderColor }]} />
                <Pressable
                  style={({ pressed }) => [styles.confirmCancelBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => setShowAnnDeleteConfirm(false)}>
                  <Text style={[styles.confirmCancelText, { color: textColor }]}>Cancel</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          )}
        </SafeAreaView>
      </Modal>

      {/* Pantry Edit / Add Modal */}
      <Modal
        visible={showForm}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeForm}>
        <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }]} edges={['top']}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

            {/* Modal Header */}
            <View style={[styles.modalHeader, { borderBottomColor: borderColor }]}>
              <Pressable onPress={closeForm}>
                <Text style={[styles.modalCancel, { color: mutedColor }]}>Cancel</Text>
              </Pressable>
              <Text style={[styles.modalTitle, { color: textColor }]}>
                {isAdding ? 'New Pantry' : 'Edit Pantry'}
              </Text>
              <Pressable onPress={handleSave} disabled={saving}>
                <Text style={[styles.modalSave, saving && { opacity: 0.4 }]}>
                  {saving ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + 32 }]}
              keyboardShouldPersistTaps="handled">

              {/* Info Section */}
              <Text style={[styles.sectionLabel, { color: mutedColor }]}>PANTRY INFO</Text>
              <View style={[styles.fieldGroup, { backgroundColor: cardBg, borderColor }]}>
                <FormField label="Name" value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  placeholder="Pantry name"
                  textColor={textColor} mutedColor={mutedColor} />
                <View style={[styles.fieldDivider, { backgroundColor: borderColor }]} />
                <FormField label="Type" value={form.service_type}
                  onChangeText={(v) => setForm((f) => ({ ...f, service_type: v }))}
                  placeholder="e.g. Food Pantry, Meal Site"
                  textColor={textColor} mutedColor={mutedColor} />
                <View style={[styles.fieldDivider, { backgroundColor: borderColor }]} />
                <FormField label="Street" value={form.street}
                  onChangeText={(v) => setForm((f) => ({ ...f, street: v }))}
                  placeholder="123 Main St"
                  textColor={textColor} mutedColor={mutedColor} />
                <View style={[styles.fieldDivider, { backgroundColor: borderColor }]} />
                <View style={styles.rowFields}>
                  <View style={{ flex: 2 }}>
                    <FormField label="City" value={form.city}
                      onChangeText={(v) => setForm((f) => ({ ...f, city: v }))}
                      placeholder="Newark"
                      textColor={textColor} mutedColor={mutedColor} />
                  </View>
                  <View style={[styles.colDivider, { backgroundColor: borderColor }]} />
                  <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 4 }}>
                    <Text style={[styles.timeInputLabel, { color: mutedColor }]}>State</Text>
                    <TextInput
                      style={[styles.fieldInput, { color: textColor }]}
                      value={form.state}
                      onChangeText={(v) => setForm((f) => ({ ...f, state: v }))}
                      placeholder="OH"
                      placeholderTextColor={mutedColor}
                      returnKeyType="next"
                    />
                  </View>
                  <View style={[styles.colDivider, { backgroundColor: borderColor }]} />
                  <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 4 }}>
                    <Text style={[styles.timeInputLabel, { color: mutedColor }]}>ZIP</Text>
                    <TextInput
                      style={[styles.fieldInput, { color: textColor }]}
                      value={form.zip}
                      onChangeText={(v) => setForm((f) => ({ ...f, zip: v }))}
                      placeholder="43055"
                      placeholderTextColor={mutedColor}
                      keyboardType="numeric"
                      returnKeyType="next"
                    />
                  </View>
                </View>
              </View>

              {/* Status */}
              <Text style={[styles.sectionLabel, { color: mutedColor }]}>STATUS</Text>
              <View style={[styles.fieldGroup, { backgroundColor: cardBg, borderColor }]}>
                <View style={styles.switchRow}>
                  <View>
                    <Text style={[styles.switchLabel, { color: textColor }]}>Temporarily Closed</Text>
                    <Text style={[styles.switchSub, { color: mutedColor }]}>
                      Hides this pantry from the map
                    </Text>
                  </View>
                  <Switch
                    value={form.isClosed}
                    onValueChange={(v) => setForm((f) => ({ ...f, isClosed: v }))}
                    trackColor={{ false: '#D1D5DB', true: '#2563EB' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>

              {/* Hours */}
              <Text style={[styles.sectionLabel, { color: mutedColor }]}>HOURS</Text>
              <View style={[styles.fieldGroup, { backgroundColor: cardBg, borderColor }]}>
                {form.hours.length === 0 ? (
                  <Text style={[styles.noHoursText, { color: mutedColor }]}>No hours added yet</Text>
                ) : (
                  form.hours.map((h, i) => (
                    <View key={i}>
                      {i > 0 && <View style={[styles.fieldDivider, { backgroundColor: borderColor }]} />}
                      <View style={styles.hourRow}>
                        <Text style={[styles.hourDay, { color: textColor }]}>
                          {getDayAbbrev(h.weekday)}
                        </Text>
                        <Text style={[styles.hourTime, { color: mutedColor }]}>
                          {h.open_time} – {h.close_time}
                        </Text>
                        <Pressable onPress={() => removeHourSlot(i)} style={styles.removeHourBtn}>
                          <Text style={styles.removeHourBtnText}>✕</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}

                <View style={[styles.fieldDivider, { backgroundColor: borderColor }]} />

                {/* Add new slot */}
                <Text style={[styles.addSlotLabel, { color: mutedColor }]}>Add time slot</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll}
                  contentContainerStyle={styles.dayScrollContent}>
                  {WEEKDAYS.map((day) => (
                    <Pressable
                      key={day}
                      style={[
                        styles.dayChip,
                        { borderColor },
                        newHour.weekday === day && styles.dayChipActive,
                      ]}
                      onPress={() => setNewHour((h) => ({ ...h, weekday: day }))}>
                      <Text style={[
                        styles.dayChipText,
                        { color: mutedColor },
                        newHour.weekday === day && styles.dayChipTextActive,
                      ]}>
                        {WEEKDAY_ABBREV[day]}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={styles.timeInputRow}>
                  <View style={styles.timeInputGroup}>
                    <Text style={[styles.timeInputLabel, { color: mutedColor }]}>Open</Text>
                    <TextInput
                      style={[styles.timeInput, { backgroundColor: inputBg, borderColor, color: textColor }]}
                      value={newHour.open_time}
                      onChangeText={(v) => setNewHour((h) => ({ ...h, open_time: v }))}
                      placeholder="09:00"
                      placeholderTextColor={mutedColor}
                    />
                  </View>
                  <Text style={[styles.timeSeparator, { color: mutedColor }]}>–</Text>
                  <View style={styles.timeInputGroup}>
                    <Text style={[styles.timeInputLabel, { color: mutedColor }]}>Close</Text>
                    <TextInput
                      style={[styles.timeInput, { backgroundColor: inputBg, borderColor, color: textColor }]}
                      value={newHour.close_time}
                      onChangeText={(v) => setNewHour((h) => ({ ...h, close_time: v }))}
                      placeholder="17:00"
                      placeholderTextColor={mutedColor}
                    />
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.addSlotBtn, pressed && { opacity: 0.8 }]}
                    onPress={addHourSlot}>
                    <Text style={styles.addSlotBtnText}>+ Add</Text>
                  </Pressable>
                </View>
              </View>

              {/* Delete (edit mode only) */}
              {!isAdding && (
                <Pressable
                  style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => setShowDeleteConfirm(true)}>
                  <Text style={styles.deleteBtnText}>Delete Pantry</Text>
                </Pressable>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
          {/* Delete Confirmation */}
          {showDeleteConfirm && (
            <Pressable style={styles.confirmOverlay} onPress={() => setShowDeleteConfirm(false)}>
              <Pressable style={[styles.confirmCard, { backgroundColor: bg, borderColor }]} onPress={() => {}}>
                <Text style={[styles.confirmTitle, { color: textColor }]}>Delete Pantry?</Text>
                <Text style={[styles.confirmBody, { color: mutedColor }]}>
                  {editTarget?.name} will be permanently removed. This cannot be undone.
                </Text>
                <View style={[styles.confirmDivider, { backgroundColor: borderColor }]} />
                <Pressable
                  style={({ pressed }) => [styles.confirmDeleteBtn, pressed && { opacity: 0.8 }]}
                  onPress={handleDelete}
                  disabled={saving}>
                  <Text style={styles.confirmDeleteText}>{saving ? 'Deleting…' : 'Delete'}</Text>
                </Pressable>
                <View style={[styles.confirmDivider, { backgroundColor: borderColor }]} />
                <Pressable
                  style={({ pressed }) => [styles.confirmCancelBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => setShowDeleteConfirm(false)}>
                  <Text style={[styles.confirmCancelText, { color: textColor }]}>Cancel</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function FormField({
  label, value, onChangeText, placeholder,
  textColor, mutedColor, keyboardType,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder: string; textColor: string; mutedColor: string;
  keyboardType?: 'default' | 'numeric' | 'email-address';
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: mutedColor }]}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { color: textColor }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={mutedColor}
        keyboardType={keyboardType ?? 'default'}
        returnKeyType="next"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#2563EB',
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#2563EB',
  },

  // Announcement list items
  emptyText: { padding: 32, fontSize: 15, textAlign: 'center' },
  annRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  annCategoryBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  annCategoryBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  annDraftBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  annDraftBadgeText: { fontSize: 11, fontWeight: '600' },

  // Announcement form
  annCategoryRow: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  annCatChip: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1.5,
  },
  annCatChipText: { fontSize: 13, fontWeight: '700' },

  // Date picker
  pickerBtn: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  pickerBtnText: { color: '#2563EB', fontSize: 13, fontWeight: '700' },
  pickerClearBtn: {
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  pickerClearBtnText: { color: '#EF4444', fontSize: 13, fontWeight: '600' },
  datePickerContainer: { paddingHorizontal: 16, paddingBottom: 12 },
  datePickerActions: { flexDirection: 'row', gap: 10, marginTop: 8 },

  // Radio buttons
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { minWidth: 70 },
  backBtnText: { fontSize: 16, fontWeight: '500' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  signOutBtn: { minWidth: 70, alignItems: 'flex-end' },
  signOutText: { fontSize: 15, color: '#EF4444', fontWeight: '500' },

  // Toolbar
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  addBtn: {
    height: 40,
    paddingHorizontal: 16,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },

  // List
  list: { paddingTop: 4 },
  separator: { height: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontWeight: '600' },
  rowAddress: { fontSize: 13 },
  rowHoursRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  rowHoursCount: { fontSize: 12 },
  editBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  editBtnText: { fontSize: 14, fontWeight: '600' },

  // Modal
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalCancel: { fontSize: 16 },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalSave: { fontSize: 16, fontWeight: '700', color: '#2563EB' },
  formContent: { padding: 20, gap: 6 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 6,
    marginLeft: 4,
  },
  fieldGroup: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fieldDivider: { height: StyleSheet.hairlineWidth },
  colDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    width: 52,
  },
  fieldInput: {
    flex: 1,
    fontSize: 15,
  },
  rowFields: { flexDirection: 'row' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  switchLabel: { fontSize: 15, fontWeight: '500' },
  switchSub: { fontSize: 12, marginTop: 2 },

  // Hours
  noHoursText: { padding: 16, fontSize: 14, textAlign: 'center' },
  hourRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  hourDay: { fontSize: 14, fontWeight: '600', width: 52 },
  hourTime: { flex: 1, fontSize: 14 },
  removeHourBtn: { padding: 4 },
  removeHourBtnText: { color: '#EF4444', fontSize: 14, fontWeight: '600' },
  addSlotLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  dayScroll: { paddingLeft: 16 },
  dayScrollContent: { gap: 6, paddingRight: 16 },
  dayChip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  dayChipActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  dayChipText: { fontSize: 13, fontWeight: '600' },
  dayChipTextActive: { color: '#FFFFFF' },
  timeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  timeInputGroup: { flex: 1, gap: 4 },
  timeInputLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  timeInput: {
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 15,
    textAlign: 'center',
  },
  timeSeparator: { fontSize: 18, marginTop: 16 },
  addSlotBtn: {
    height: 40,
    paddingHorizontal: 16,
    backgroundColor: '#2563EB',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  addSlotBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  deleteBtn: {
    marginTop: 24,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  deleteBtnText: { color: '#EF4444', fontWeight: '700', fontSize: 16 },

  // Delete confirmation
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    zIndex: 100,
  },
  confirmCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  confirmBody: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
    lineHeight: 20,
  },
  confirmDivider: { height: StyleSheet.hairlineWidth },
  confirmDeleteBtn: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmDeleteText: { color: '#EF4444', fontSize: 16, fontWeight: '600' },
  confirmCancelBtn: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmCancelText: { fontSize: 16, fontWeight: '400' },
});
