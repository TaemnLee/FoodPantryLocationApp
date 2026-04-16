import DateTimePicker from "@react-native-community/datetimepicker";
import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Animated,
  ActivityIndicator,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import { useThemeColor } from "@/hooks/use-theme-color";
import { supabase } from "@/lib/supabase";
import type { PantryLocation, PantryOpHours, Announcement, PantryInventory } from "@/types/pantry";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_ABBREV: Record<string, string> = {
  sunday: "Sun",
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
};

function matchWeekday(h: PantryOpHours, day: string, dayIndex: number): boolean {
  const w = String(h.weekday ?? "").toLowerCase().trim();
  if (w === day) return true;
  if (day.startsWith(w.slice(0, 3)) || w.startsWith(day.slice(0, 3))) return true;
  const num = parseInt(w, 10);
  if (!Number.isNaN(num) && num >= 0 && num <= 6) return num === dayIndex;
  return false;
}

function getHoursForDay(pantry: PantryLocation, dayIndex: number): PantryOpHours[] {
  const hours = pantry.pantry_op_hours;
  if (!hours?.length) return [];
  const day = WEEKDAYS[dayIndex];
  const matches = hours.filter((h) => matchWeekday(h, day, dayIndex));
  return matches.sort(
    (a, b) => timeToMinutes(a.open_time) - timeToMinutes(b.open_time)
  );
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatTimeForDisplay(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const hour = h ?? 0;
  const min = m ?? 0;
  const mm = min.toString().padStart(2, "0");
  if (hour === 0) return `12:${mm} AM`;
  if (hour < 12) return `${hour}:${mm} AM`;
  if (hour === 12) return `12:${mm} PM`;
  return `${hour - 12}:${mm} PM`;
}

function getOpenStatus(
  pantry: PantryLocation
): { isOpen: boolean; closingTime: string | null; nextOpens: string | null } {
  const now = new Date();
  const todayIndex = now.getDay();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const todaySessions = getHoursForDay(pantry, todayIndex);

  for (const session of todaySessions) {
    const openMins = timeToMinutes(session.open_time);
    const closeMins = timeToMinutes(session.close_time);
    if (nowMins >= openMins && nowMins < closeMins) {
      return { isOpen: true, closingTime: formatTimeForDisplay(session.close_time), nextOpens: null };
    }
  }

  for (const session of todaySessions) {
    const openMins = timeToMinutes(session.open_time);
    if (nowMins < openMins) {
      return {
        isOpen: false,
        closingTime: null,
        nextOpens: `Opens ${formatTimeForDisplay(session.open_time)}`,
      };
    }
  }

  for (let i = 1; i <= 7; i++) {
    const dayIndex = (todayIndex + i) % 7;
    const daySessions = getHoursForDay(pantry, dayIndex);
    if (daySessions.length) {
      const first = daySessions[0];
      const dayAbbrev = WEEKDAY_ABBREV[WEEKDAYS[dayIndex]] ?? WEEKDAYS[dayIndex].slice(0, 3);
      return {
        isOpen: false,
        closingTime: null,
        nextOpens: `Opens ${formatTimeForDisplay(first.open_time)} ${dayAbbrev}`,
      };
    }
  }

  const hours = pantry.pantry_op_hours;
  if (hours?.length) {
    const first = hours[0];
    const dayLabel = first.weekday ? ` ${String(first.weekday).slice(0, 3)}` : "";
    return {
      isOpen: false,
      closingTime: null,
      nextOpens: `Opens ${formatTimeForDisplay(first.open_time)}${dayLabel}`,
    };
  }

  return { isOpen: false, closingTime: null, nextOpens: null };
}

function isOpenNow(pantry: PantryLocation): boolean {
  return getOpenStatus(pantry).isOpen;
}

function opensLaterToday(pantry: PantryLocation): boolean {
  const todaySessions = getHoursForDay(pantry, new Date().getDay());
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  return todaySessions.some((s) => timeToMinutes(s.open_time) > nowMins);
}

function makeNoon(): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

const INV_LABELS: { key: keyof Omit<PantryInventory, 'pantry_id' | 'name' | 'last_updated'>; label: string }[] = [
  { key: 'canned_food', label: 'Canned Food' },
  { key: 'dry_grains', label: 'Dry Grains' },
  { key: 'cereal', label: 'Cereal' },
  { key: 'dairy', label: 'Dairy' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'fresh_produce', label: 'Fresh Produce' },
  { key: 'fresh_protein', label: 'Fresh Protein' },
  { key: 'frozen_food', label: 'Frozen Food' },
  { key: 'bread', label: 'Bread' },
  { key: 'beverages', label: 'Beverages' },
  { key: 'baby_items', label: 'Baby Items' },
  { key: 'snacks', label: 'Snacks' },
];

const LICKING_COUNTY_REGION: Region = {
  latitude: 40.08,
  longitude: -82.48,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

function matchesSearch(pantry: PantryLocation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const searchable = [
    pantry.name,
    pantry.street,
    pantry.city,
    pantry.state,
    pantry.zip,
  ].join(" ");
  return searchable.toLowerCase().includes(q);
}

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type UserCoords = { latitude: number; longitude: number };


export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const markerRefs = useRef<Record<string, { showCallout?: () => void; hideCallout?: () => void } | null>>({});
  const selectedMarkerIdRef = useRef<string | null>(null);
  const [detailPantry, setDetailPantry] = useState<PantryLocation | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  function openDetail(pantry: PantryLocation) {
    selectedMarkerIdRef.current = pantry.pantry_id;
    setDetailPantry(pantry);
    setSheetVisible(true);
    sheetAnim.setValue(0);
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, bounciness: 4 }).start();
  }

  function closeDetail() {
    if (selectedMarkerIdRef.current) {
      markerRefs.current[selectedMarkerIdRef.current]?.hideCallout?.();
      selectedMarkerIdRef.current = null;
    }
    Animated.timing(sheetAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setSheetVisible(false);
      setDetailPantry(null);
    });
  }
  const [userCoords, setUserCoords] = useState<UserCoords | null>(null);
  const [pantries, setPantries] = useState<PantryLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterOpenNow, setFilterOpenNow] = useState(false);
  const [filterDay, setFilterDay] = useState<number | null>(null);
  const [filterDayLabel, setFilterDayLabel] = useState<string | null>(null);
  const [filterMaxMiles, setFilterMaxMiles] = useState<number | null>(null);
  const [filterTime, setFilterTime] = useState<string | null>(null);
  const [filterTimeDate, setFilterTimeDate] = useState<Date>(makeNoon);
  const [expandedFilter, setExpandedFilter] = useState<"when" | "distance" | null>(null);
  const [inventories, setInventories] = useState<PantryInventory[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annDismissed, setAnnDismissed] = useState<Set<string>>(new Set());
  const [annDetailModal, setAnnDetailModal] = useState<Announcement | null>(null);
  const cardBg = useThemeColor({}, "background");
  const cardText = useThemeColor({}, "text");
  const cardMuted = useThemeColor({}, "icon");
  const chipBg = useThemeColor({ light: "#FFFFFF", dark: "#2C2F30" }, "background");
  const chipBorderColor = useThemeColor({ light: "rgba(0,0,0,0.1)", dark: "rgba(255,255,255,0.15)" }, "background");
  const chipStyle = { backgroundColor: chipBg, borderColor: chipBorderColor };
  const chipTextStyle = { color: cardText };

  const searchResults = useMemo(() => {
    let filtered = pantries.filter((p) => matchesSearch(p, searchQuery));
    if (filterOpenNow) filtered = filtered.filter(isOpenNow);
    if (filterDay !== null) filtered = filtered.filter((p) => getHoursForDay(p, filterDay).length > 0);
    if (filterTime !== null) {
      const timeMins = timeToMinutes(filterTime);
      filtered = filtered.filter((p) => {
        const hours = filterDay !== null ? getHoursForDay(p, filterDay) : (p.pantry_op_hours ?? []);
        return hours.some((h) => timeToMinutes(h.open_time) <= timeMins && timeMins < timeToMinutes(h.close_time));
      });
    }
    if (filterMaxMiles !== null && userCoords) {
      filtered = filtered.filter(
        (p) => distanceMiles(userCoords.latitude, userCoords.longitude, p.latitude, p.longitude) <= filterMaxMiles
      );
    }
    if (userCoords) {
      return [...filtered].sort(
        (a, b) =>
          distanceMiles(userCoords.latitude, userCoords.longitude, a.latitude, a.longitude) -
          distanceMiles(userCoords.latitude, userCoords.longitude, b.latitude, b.longitude)
      );
    }
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [pantries, searchQuery, userCoords, filterOpenNow, filterDay, filterTime, filterMaxMiles]);

  const visiblePantries = useMemo(() => {
    let filtered = [...pantries];
    if (filterOpenNow) filtered = filtered.filter(isOpenNow);
    if (filterDay !== null) filtered = filtered.filter((p) => getHoursForDay(p, filterDay).length > 0);
    if (filterTime !== null) {
      const timeMins = timeToMinutes(filterTime);
      filtered = filtered.filter((p) => {
        const hours = filterDay !== null ? getHoursForDay(p, filterDay) : (p.pantry_op_hours ?? []);
        return hours.some((h) => timeToMinutes(h.open_time) <= timeMins && timeMins < timeToMinutes(h.close_time));
      });
    }
    if (filterMaxMiles !== null && userCoords) {
      filtered = filtered.filter(
        (p) => distanceMiles(userCoords.latitude, userCoords.longitude, p.latitude, p.longitude) <= filterMaxMiles
      );
    }
    return filtered;
  }, [pantries, userCoords, filterOpenNow, filterDay, filterTime, filterMaxMiles]);

  const showSearchDropdown = searchFocused;

  const nearest = useMemo(() => {
    if (!userCoords || pantries.length === 0) return null;
    const dist = (p: PantryLocation) =>
      distanceMiles(userCoords!.latitude, userCoords!.longitude, p.latitude, p.longitude);
    const byDist = (a: PantryLocation, b: PantryLocation) => dist(a) - dist(b);

    const activePantries = pantries.filter((p) => !p.temporary_closure);
    const openNow = activePantries.filter(isOpenNow).sort(byDist);
    if (openNow.length) {
      const p = openNow[0];
      return { pantry: p, miles: dist(p), label: "Nearest open now" as const };
    }

    const openToday = activePantries.filter(opensLaterToday).sort(byDist);
    if (openToday.length) {
      const p = openToday[0];
      return { pantry: p, miles: dist(p), label: "Nearest open today" as const };
    }

    if (!activePantries.length) return null;
    const closest = activePantries.reduce((a, b) => (dist(a) < dist(b) ? a : b));
    return { pantry: closest, miles: dist(closest), label: "Nearest pantry" as const };
  }, [userCoords, pantries]);

  const displayPantry = nearest?.pantry ?? null;
  const displayLabel = nearest?.label ?? "Nearest pantry";
  const displayMiles =
    displayPantry && userCoords
      ? distanceMiles(userCoords.latitude, userCoords.longitude, displayPantry.latitude, displayPantry.longitude)
      : null;

  const activeAnnouncements = useMemo(() => {
    const now = new Date();
    return announcements.filter((a) => {
      const isLive = a.published || (a.scheduled_for && new Date(a.scheduled_for) <= now);
      const notExpired = !a.expires_at || new Date(a.expires_at) > now;
      return isLive && notExpired;
    });
  }, [announcements]);

  const visibleBannerAnnouncements = useMemo(() => {
    return activeAnnouncements.filter((a) => a.pantry_id === null && !annDismissed.has(a.id));
  }, [activeAnnouncements, annDismissed]);

  function getAnnouncementsForPantry(pantryId: string): Announcement[] {
    return activeAnnouncements.filter((a) => a.pantry_id === pantryId || a.pantry_id === null);
  }

  function hasActiveAnnouncement(pantryId: string): Announcement | undefined {
    const priority: Announcement['category'][] = ['urgent', 'hours_change', 'event', 'general'];
    for (const cat of priority) {
      const found = activeAnnouncements.find(
        (a) => (a.pantry_id === pantryId || a.pantry_id === null) && a.category === cat
      );
      if (found) return found;
    }
    return undefined;
  }

  function getAnnColor(category: string): string {
    switch (category) {
      case 'urgent': return '#EF4444';
      case 'hours_change': return '#F59E0B';
      case 'event': return '#8B5CF6';
      default: return '#6B7280';
    }
  }

  function getAnnPinColor(category: string): string {
    switch (category) {
      case 'urgent': return '#EF4444';
      case 'hours_change': return '#F59E0B';
      case 'event': return '#8B5CF6';
      case 'general': return '#3B82F6';
      default: return '#3B82F6';
    }
  }

  async function fetchAnnouncements() {
    const { data } = await supabase
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false });
    setAnnouncements(data ?? []);
  }

  async function fetchInventories() {
    const { data } = await supabase.from("pantry_inventory").select("*");
    setInventories(data ?? []);
  }

async function fetchPantries() {
  try {
    const [{ data: locations, error: locError }, { data: hours, error: hoursError }, { data: mains }] =
      await Promise.all([
        supabase.from("pantry_location").select("*"),
        supabase.from("pantry_op_hours").select("*"),
        supabase.from("pantry_main").select("pantry_id, temporary_closure"),
      ]);

    if (locError) {
      console.error("Supabase pantry_location error:", locError);
      return;
    }

    if (hoursError) {
      console.warn("Supabase pantry_op_hours error (hours not loaded):", hoursError);
    }

    const allHours = hours ?? [];
    const closureMap = Object.fromEntries(
      (mains ?? []).map((m) => [String(m.pantry_id), m.temporary_closure ?? false])
    );

    const pantriesWithHours = (locations ?? []).map((p) => ({
      ...p,
      temporary_closure: closureMap[String(p.pantry_id)] ?? false,
      pantry_op_hours: allHours.filter(
        (h) => String(h.pantry_id) === String(p.pantry_id)
      ),
    }));

    setPantries(pantriesWithHours);
  } finally {
    setLoading(false);
  }
}

useEffect(() => {
  fetchPantries();
  fetchAnnouncements();
  fetchInventories();
}, []);

useFocusEffect(useCallback(() => {
  fetchPantries();
  fetchAnnouncements();
  fetchInventories();
}, []));

useEffect(() => {
  const channel = supabase
    .channel("pantry-realtime")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pantry_location",
      },
      () => {
        fetchPantries();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pantry_op_hours",
      },
      () => {
        fetchPantries();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pantry_main",
      },
      () => {
        fetchPantries();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "announcements",
      },
      () => {
        fetchAnnouncements();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pantry_inventory",
      },
      () => {
        fetchInventories();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, []);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== "granted") return;
      Location.getCurrentPositionAsync({}).then(({ coords }) => {
        setUserCoords({ latitude: coords.latitude, longitude: coords.longitude });
      });
    });
  }, []);

  function selectPantry(pantry: PantryLocation) {
    Keyboard.dismiss();
    setSearchFocused(false);
    setSearchQuery("");
    mapRef.current?.animateToRegion(
      {
        latitude: pantry.latitude,
        longitude: pantry.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      500
    );
    setTimeout(() => {
      markerRefs.current[pantry.pantry_id]?.showCallout?.();
    }, 550);
  }

  function openDirections(pantry: PantryLocation) {
    const { latitude, longitude } = pantry;
    const url =
      Platform.OS === "ios"
        ? `maps://?daddr=${latitude},${longitude}`
        : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
    Linking.openURL(url).catch((err) => console.warn("Could not open directions:", err));
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={LICKING_COUNTY_REGION}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        showsUserLocation={!!userCoords}
        showsMyLocationButton={!!userCoords}
        mapPadding={{ bottom: displayPantry ? 120 : 30, top: 0, left: 0, right: 0 }}>
        {visiblePantries.map((pantry) => {
          const isTempClosed = pantry.temporary_closure === true;
          const pantryAnn = hasActiveAnnouncement(pantry.pantry_id);
          const pinColor = isTempClosed ? "#9CA3AF" : pantryAnn ? getAnnPinColor(pantryAnn.category) : undefined;
          return (
            <Marker
              key={pantry.pantry_id}
              ref={(ref) => { markerRefs.current[pantry.pantry_id] = ref; }}
              coordinate={{ latitude: pantry.latitude, longitude: pantry.longitude }}
              pinColor={pinColor}
              onPress={() => openDetail(pantry)}
            />
          );
        })}
      </MapView>

      <View style={[styles.searchContainer, { top: insets.top + 8 }]} pointerEvents="box-none">
        <TextInput
          style={[styles.searchInput, { backgroundColor: cardBg, color: cardText }]}
          placeholder="Search pantry name or address"
          placeholderTextColor={cardMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          returnKeyType="search"
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterRowContent}
          keyboardShouldPersistTaps="handled">
          <Pressable
            style={[styles.filterChip, chipStyle, filterOpenNow && styles.filterChipActive]}
            onPress={() => {
              const next = !filterOpenNow;
              setFilterOpenNow(next);
              if (next) { setFilterDay(null); setFilterDayLabel(null); setFilterTime(null); setFilterTimeDate(makeNoon()); }
              setExpandedFilter(null);
            }}>
            <Text style={[styles.filterChipText, chipTextStyle, filterOpenNow && styles.filterChipTextActive]}>
              Open Now
            </Text>
          </Pressable>

          <Pressable
            style={[styles.filterChip, chipStyle, (filterDay !== null || filterTime !== null || expandedFilter === "when") && styles.filterChipActive]}
            onPress={() => setExpandedFilter(expandedFilter === "when" ? null : "when")}>
            <Text style={[styles.filterChipText, chipTextStyle, (filterDay !== null || filterTime !== null || expandedFilter === "when") && styles.filterChipTextActive]}>
              {[
                filterDay !== null ? (filterDayLabel ?? WEEKDAY_ABBREV[WEEKDAYS[filterDay]]) : null,
                filterTime !== null ? formatTimeForDisplay(filterTime) : null,
              ].filter(Boolean).join(" ") || "When"} ▾
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.filterChip,
              chipStyle,
              !userCoords && styles.filterChipDisabled,
              (filterMaxMiles !== null || expandedFilter === "distance") && styles.filterChipActive,
            ]}
            disabled={!userCoords}
            onPress={() => setExpandedFilter(expandedFilter === "distance" ? null : "distance")}>
            <Text style={[styles.filterChipText, chipTextStyle, (filterMaxMiles !== null || expandedFilter === "distance") && styles.filterChipTextActive]}>
              {filterMaxMiles !== null ? `${filterMaxMiles} mi` : "Distance"} ▾
            </Text>
          </Pressable>
        </ScrollView>

        {expandedFilter === "when" && (
          <View style={[styles.filterPicker, { backgroundColor: cardBg, gap: 0 }]}>
            <Text style={[styles.filterPickerSectionLabel, { color: cardMuted }]}>Day</Text>
            <View style={styles.filterPickerRow}>
              {[
                { label: "Today", index: new Date().getDay() },
                { label: "Tomorrow", index: (new Date().getDay() + 1) % 7 },
                ...WEEKDAYS.map((day, i) => ({ label: WEEKDAY_ABBREV[day], index: i })),
              ].map(({ label, index }) => {
                const isActive = filterDay === index && filterDayLabel === label;
                return (
                  <Pressable
                    key={label}
                    style={[styles.filterPickerChip, chipStyle, isActive && styles.filterChipActive]}
                    onPress={() => {
                      if (isActive) {
                        setFilterDay(null);
                        setFilterDayLabel(null);
                      } else {
                        setFilterDay(index);
                        setFilterDayLabel(label);
                        setFilterOpenNow(false);
                      }
                    }}>
                    <Text style={[styles.filterPickerChipText, chipTextStyle, isActive && styles.filterChipTextActive]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.filterPickerDivider, { backgroundColor: cardMuted }]} />
            <Text style={[styles.filterPickerSectionLabel, { color: cardMuted }]}>
              Time{filterTime !== null ? ` — ${formatTimeForDisplay(filterTime)}` : ""}
            </Text>
            <DateTimePicker
              mode="time"
              display="spinner"
              value={filterTimeDate}
              minuteInterval={30}
              onChange={(_e, date) => {
                if (!date) return;
                setFilterTimeDate(date);
                const h = String(date.getHours()).padStart(2, "0");
                const m = String(date.getMinutes()).padStart(2, "0");
                setFilterTime(`${h}:${m}`);
                setFilterOpenNow(false);
                if (filterDay === null) {
                  setFilterDay(new Date().getDay());
                  setFilterDayLabel("Today");
                }
              }}
              textColor={cardText}
            />
            <Pressable
              onPress={() => {
                setFilterDay(null);
                setFilterDayLabel(null);
                setFilterTime(null);
                setFilterTimeDate(makeNoon());
                setFilterOpenNow(false);
                setFilterMaxMiles(null);
                setExpandedFilter(null);
              }}
              style={styles.filterPickerClear}>
              <Text style={styles.filterPickerClearText}>Reset All Filters</Text>
            </Pressable>
          </View>
        )}

        {expandedFilter === "distance" && (
          <View style={[styles.filterPicker, { backgroundColor: cardBg }]}>
            {[5, 10, 25, 50].map((miles) => (
              <Pressable
                key={miles}
                style={[styles.filterPickerChip, chipStyle, filterMaxMiles === miles && styles.filterChipActive]}
                onPress={() => {
                  setFilterMaxMiles(filterMaxMiles === miles ? null : miles);
                  setExpandedFilter(null);
                }}>
                <Text style={[styles.filterPickerChipText, chipTextStyle, filterMaxMiles === miles && styles.filterChipTextActive]}>
                  {miles} mi
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {showSearchDropdown && (
          <View style={[styles.searchDropdown, { backgroundColor: cardBg }]}>
            <ScrollView
              style={styles.searchResults}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled>
              {searchResults.length === 0 ? (
                <Text style={[styles.searchEmpty, { color: cardMuted }]}>
                  No pantries found. Try a different search.
                </Text>
              ) : (
                searchResults.map((pantry) => {
                  const miles =
                    userCoords &&
                    distanceMiles(userCoords.latitude, userCoords.longitude, pantry.latitude, pantry.longitude);
                  return (
                    <Pressable
                      key={pantry.pantry_id}
                      style={({ pressed }) => [
                        styles.searchResultItem,
                        pressed && styles.searchResultItemPressed,
                      ]}
                      onPress={() => selectPantry(pantry)}>
                      <View style={styles.searchResultContent}>
                        <Text style={[styles.searchResultName, { color: cardText }]} numberOfLines={1}>
                          {pantry.name}
                        </Text>
                        <Text style={[styles.searchResultAddress, { color: cardMuted }]} numberOfLines={1}>
                          {pantry.street}, {pantry.city}
                        </Text>
                      </View>
                      {miles != null && (
                        <Text style={[styles.searchResultDistance, { color: cardMuted }]}>
                          {miles.toFixed(1)} mi
                        </Text>
                      )}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        )}
      </View>

      {(showSearchDropdown || expandedFilter !== null) && (
        <Pressable
          style={styles.searchOverlay}
          onPress={() => {
            Keyboard.dismiss();
            setSearchFocused(false);
            setExpandedFilter(null);
          }}
        />
      )}

      {!showSearchDropdown && visibleBannerAnnouncements.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.annBannerRow, { top: insets.top + 120 }]}
          contentContainerStyle={styles.annBannerRowContent}>
          {visibleBannerAnnouncements.map((ann) => {
            const color = getAnnColor(ann.category);
            const pantryName = ann.pantry_id
              ? pantries.find((p) => p.pantry_id === ann.pantry_id)?.name ?? "Unknown"
              : "All Pantries";
            return (
              <Pressable
                key={ann.id}
                style={[styles.annBanner, { backgroundColor: cardBg, borderLeftColor: color }]}
                onPress={() => setAnnDetailModal(ann)}>
                <View style={styles.annBannerContent}>
                  <View style={styles.annBannerHeaderRow}>
                    <View style={[styles.annBannerCatDot, { backgroundColor: color }]} />
                    <Text style={[styles.annBannerPantryName, { color: cardMuted }]} numberOfLines={1}>
                      {pantryName}
                    </Text>
                  </View>
                  <Text style={[styles.annBannerTitle, { color: cardText }]} numberOfLines={1}>
                    {ann.title}
                  </Text>
                </View>
                <Pressable
                  style={styles.annBannerDismiss}
                  hitSlop={8}
                  onPress={(e) => {
                    e.stopPropagation();
                    setAnnDismissed((prev) => new Set(prev).add(ann.id));
                  }}>
                  <Text style={[styles.annBannerDismissText, { color: cardMuted }]}>✕</Text>
                </Pressable>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Announcement Detail Modal */}
      {annDetailModal && (
        <Modal
          visible={true}
          transparent
          animationType="fade"
          onRequestClose={() => setAnnDetailModal(null)}>
          <Pressable
            style={styles.annDetailOverlay}
            onPress={() => setAnnDetailModal(null)}>
            <Pressable
              style={[styles.annDetailCard, { backgroundColor: cardBg }]}
              onPress={(e) => e.stopPropagation()}>
              <View style={[styles.annDetailCatBadge, { backgroundColor: getAnnColor(annDetailModal.category) + '20' }]}>
                <Text style={[styles.annDetailCatText, { color: getAnnColor(annDetailModal.category) }]}>
                  {annDetailModal.category === 'hours_change' ? 'Hours Change'
                    : annDetailModal.category.charAt(0).toUpperCase() + annDetailModal.category.slice(1)}
                </Text>
              </View>
              <Text style={[styles.annDetailTitle, { color: cardText }]}>
                {annDetailModal.title}
              </Text>
              <Text style={[styles.annDetailPantry, { color: cardMuted }]}>
                {annDetailModal.pantry_id
                  ? pantries.find((p) => p.pantry_id === annDetailModal.pantry_id)?.name ?? "Unknown Pantry"
                  : "All Pantries"}
              </Text>
              <View style={[styles.annDetailDivider, { backgroundColor: cardMuted + '30' }]} />
              <Text style={[styles.annDetailBody, { color: cardText }]}>
                {annDetailModal.body}
              </Text>
              {annDetailModal.expires_at && (
                <Text style={[styles.annDetailExpires, { color: cardMuted }]}>
                  Expires: {new Date(annDetailModal.expires_at).toLocaleString()}
                </Text>
              )}
              <Pressable
                style={styles.annDetailCloseBtn}
                onPress={() => setAnnDetailModal(null)}>
                <Text style={styles.annDetailCloseBtnText}>Close</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {!showSearchDropdown && displayPantry && (() => {
        const isTempClosed = displayPantry.temporary_closure === true;
        const displayAnn = hasActiveAnnouncement(displayPantry.pantry_id);
        const { isOpen, closingTime, nextOpens } = getOpenStatus(displayPantry);
        const statusText = isTempClosed
          ? "Temporarily Closed"
          : displayAnn
            ? displayAnn.title
            : isOpen ? closingTime ? `Open until ${closingTime}` : "Open" : nextOpens ?? "Closed";
        const statusColor = isTempClosed ? "#F59E0B"
          : displayAnn ? getAnnColor(displayAnn.category)
          : isOpen ? "#16a34a" : "#dc2626";
        return (
          <Pressable
            style={[styles.bottomCard, { bottom: 8, backgroundColor: cardBg }]}
            onPress={() => openDetail(displayPantry)}>
            <View style={styles.cardBody}>
              <Text style={[styles.cardLabel, { color: cardMuted }]}>{displayLabel}</Text>
              <View style={styles.cardNameRow}>
                <Text style={[styles.cardName, { color: cardText }]} numberOfLines={1}>
                  {displayPantry.name}
                </Text>
                <Text style={[styles.cardChevron, { color: cardMuted }]}>›</Text>
              </View>
              <Text style={[styles.cardAddress, { color: cardMuted }]} numberOfLines={1}>
                {displayPantry.street}, {displayPantry.city}
              </Text>
              <Text style={[styles.cardStatus, { color: statusColor }]}>{statusText}</Text>
            </View>
            <View style={styles.cardSide}>
              {displayMiles != null && (
                <Text style={[styles.cardDistance, { color: cardText }]}>
                  {displayMiles.toFixed(1)} mi
                </Text>
              )}
              <Pressable style={styles.directionsBtn} onPress={(e) => { e.stopPropagation(); openDirections(displayPantry); }}>
                <Text style={styles.directionsBtnText}>Directions</Text>
              </Pressable>
            </View>
          </Pressable>
        );
      })()}


      <Modal
        visible={sheetVisible}
        transparent
        animationType="none"
        onRequestClose={closeDetail}>
        <Animated.View
          style={[styles.detailOverlay, { opacity: sheetAnim }]}
          pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDetail} />
          {detailPantry && (() => {
            const p = detailPantry;
            const isTempClosed = p.temporary_closure === true;
            const { isOpen, closingTime, nextOpens } = getOpenStatus(p);
            const statusText = isTempClosed
              ? "Temporarily Closed"
              : isOpen ? closingTime ? `Open until ${closingTime}` : "Open" : nextOpens ?? "Closed";
            const statusColor = isTempClosed ? "#F59E0B" : isOpen ? "#16a34a" : "#dc2626";
            const sortedHours = [...(p.pantry_op_hours ?? [])].sort((a, b) => {
              const ai = WEEKDAYS.indexOf(String(a.weekday).toLowerCase().trim());
              const bi = WEEKDAYS.indexOf(String(b.weekday).toLowerCase().trim());
              return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });
            const translateY = sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [400, 0] });
            const inv = inventories.find((i) => i.pantry_id === p.pantry_id);
            const availableItems = inv ? INV_LABELS.filter((c) => inv[c.key]) : [];
            return (
              <Animated.View
                style={[styles.detailSheet, { backgroundColor: cardBg, transform: [{ translateY }] }]}>
                <View style={styles.detailHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.detailName, { color: cardText }]}>{p.name}</Text>
                    {p.service_type ? (
                      <View style={styles.detailTypeBadge}>
                        <Text style={styles.detailTypeBadgeText}>{p.service_type}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Pressable onPress={closeDetail} style={styles.detailClose} hitSlop={12}>
                    <Text style={[styles.detailCloseText, { color: cardMuted }]}>✕</Text>
                  </Pressable>
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                  contentContainerStyle={styles.detailScrollContent}>

                  <Text style={[styles.detailAddress, { color: cardMuted }]}>
                    {p.street}, {p.city}, {p.state} {p.zip}
                  </Text>

                  <Text style={[styles.detailStatus, { color: statusColor }]}>{statusText}</Text>

                  {(() => {
                    const pantryAnns = getAnnouncementsForPantry(p.pantry_id);
                    if (!pantryAnns.length) return null;
                    return (
                      <View style={styles.detailAnnsSection}>
                        {pantryAnns.map((ann) => {
                          const color = getAnnColor(ann.category);
                          return (
                            <View key={ann.id} style={[styles.detailAnnItem, { borderLeftColor: color }]}>
                              <Text style={[styles.detailAnnTitle, { color: cardText }]}>{ann.title}</Text>
                              {ann.body ? (
                                <Text style={[styles.detailAnnBody, { color: cardMuted }]}>{ann.body}</Text>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })()}

                  {inv && (
                    <View style={styles.detailInvSection}>
                      <Text style={[styles.detailSectionLabel, { color: cardMuted }]}>Available Items</Text>
                      {availableItems.length > 0 ? (
                        <View style={styles.detailInvChips}>
                          {availableItems.map((c) => (
                            <View key={c.key} style={styles.detailInvChip}>
                              <Text style={styles.detailInvChipText}>{c.label}</Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={[styles.detailInvEmpty, { color: cardMuted }]}>
                          No items currently available
                        </Text>
                      )}
                    </View>
                  )}

                  {sortedHours.length > 0 && (
                    <View style={styles.detailHoursSection}>
                      <Text style={[styles.detailHoursTitle, { color: cardMuted }]}>Hours</Text>
                      {sortedHours.map((h, i) => (
                        <View key={i} style={styles.detailHoursRow}>
                          <Text style={[styles.detailHoursDay, { color: cardText }]}>
                            {WEEKDAY_ABBREV[String(h.weekday).toLowerCase().trim()] ?? String(h.weekday).slice(0, 3)}
                          </Text>
                          <Text style={[styles.detailHoursTime, { color: cardMuted }]}>
                            {formatTimeForDisplay(h.open_time)} – {formatTimeForDisplay(h.close_time)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  <Pressable style={styles.detailDirectionsBtn} onPress={() => { openDirections(p); closeDetail(); }}>
                    <Text style={styles.detailDirectionsBtnText}>Get Directions</Text>
                  </Pressable>
                </ScrollView>
              </Animated.View>
            );
          })()}
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  map: {
    flex: 1,
  },
  card: {
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  cardIntegrated: {
    marginTop: 8,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardName: {
    fontSize: 16,
    fontWeight: "700",
  },
  cardAddress: {
    fontSize: 13,
  },
  cardStatus: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },
  cardSide: {
    alignItems: "flex-end",
    gap: 8,
    marginLeft: 12,
  },
  cardDistance: {
    fontSize: 15,
    fontWeight: "600",
  },
  directionsBtn: {
    backgroundColor: "#2563EB",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  directionsBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  searchContainer: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 10,
  },
  searchInput: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  searchDropdown: {
    marginTop: 8,
    borderRadius: 12,
    maxHeight: 280,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  searchResults: {
    maxHeight: 272,
  },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.2)",
  },
  searchResultContent: {
    flex: 1,
    minWidth: 0,
  },
  searchResultItemPressed: {
    opacity: 0.7,
  },
  searchResultName: {
    fontSize: 16,
    fontWeight: "600",
  },
  searchResultAddress: {
    fontSize: 13,
    marginTop: 2,
  },
  searchResultDistance: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 12,
  },
  searchEmpty: {
    padding: 20,
    fontSize: 15,
    textAlign: "center",
  },
  searchOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  callout: {
    padding: 12,
    minWidth: 160,
    maxWidth: 240,
    borderRadius: 8,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: { elevation: 6 },
    }),
  },
  calloutName: {
    fontSize: 15,
    fontWeight: "700",
  },
  calloutAddress: {
    fontSize: 12,
    marginTop: 2,
  },
  calloutStatus: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },
  calloutDirectionsBtn: {
    marginTop: 10,
    backgroundColor: "#2563EB",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: "stretch",
  },
  calloutDirectionsBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  markerModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  markerModalCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 14,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  markerModalName: {
    fontSize: 18,
    fontWeight: "700",
  },
  markerModalAddress: {
    fontSize: 14,
    marginTop: 4,
  },
  markerModalStatus: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 8,
  },
  markerModalDirectionsBtn: {
    marginTop: 16,
    backgroundColor: "#2563EB",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignSelf: "stretch",
  },
  markerModalDirectionsBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  filterRow: {
    marginTop: 8,
  },
  filterRowContent: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 2,
    flexGrow: 1,
    justifyContent: "center",
  },
  filterChip: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  filterChipActive: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  filterChipDisabled: {
    opacity: 0.35,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "transparent",
  },
  filterChipTextActive: {
    color: "#FFFFFF",
  },
  filterPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  filterPickerChip: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "transparent",
  },
  filterPickerChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "transparent",
  },
  filterPickerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  filterPickerSectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 4,
  },
  filterPickerDivider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.3,
    marginVertical: 10,
  },
  filterPickerClear: {
    marginTop: 10,
    alignSelf: "flex-end",
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: "#FEF2F2",
    borderRadius: 8,
  },
  filterPickerClearText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#EF4444",
  },
  calloutAnnBody: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  markerModalAnnBody: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  annBannerRow: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 9,
    maxHeight: 80,
  },
  annBannerRowContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  annBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderLeftWidth: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 220,
    maxWidth: 300,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  annBannerContent: {
    flex: 1,
    gap: 3,
  },
  annBannerHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  annBannerCatDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  annBannerPantryName: {
    fontSize: 11,
    fontWeight: "600",
    flex: 1,
  },
  annBannerTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  annBannerDismiss: {
    padding: 6,
    marginLeft: 8,
  },
  annBannerDismissText: {
    fontSize: 14,
    fontWeight: "600",
  },
  annDetailOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  annDetailCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    padding: 24,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  annDetailCatBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
    marginBottom: 12,
  },
  annDetailCatText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  annDetailTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  annDetailPantry: {
    fontSize: 14,
    marginTop: 4,
  },
  annDetailDivider: {
    height: 1,
    marginVertical: 16,
  },
  annDetailBody: {
    fontSize: 15,
    lineHeight: 22,
  },
  annDetailExpires: {
    fontSize: 13,
    marginTop: 12,
    fontStyle: "italic",
  },
  annDetailCloseBtn: {
    marginTop: 20,
    backgroundColor: "#2563EB",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  annDetailCloseBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  bottomCard: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 10,
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  cardNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  cardChevron: {
    fontSize: 20,
    fontWeight: "300",
    lineHeight: 22,
    marginLeft: 2,
  },
  detailOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    pointerEvents: "box-none",
  },
  detailSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  detailHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(128,128,128,0.35)",
    alignSelf: "center",
    marginBottom: 8,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  detailName: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  detailTypeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#2563EB",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
  },
  detailTypeBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  detailClose: {
    paddingTop: 2,
  },
  detailCloseText: {
    fontSize: 18,
    fontWeight: "400",
  },
  detailAddress: {
    fontSize: 14,
    marginTop: 2,
  },
  detailStatus: {
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  detailHoursSection: {
    marginTop: 12,
    gap: 6,
  },
  detailHoursTitle: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailHoursRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailHoursDay: {
    fontSize: 14,
    fontWeight: "600",
    width: 40,
  },
  detailHoursTime: {
    fontSize: 14,
  },
  detailDirectionsBtn: {
    marginTop: 16,
    backgroundColor: "#2563EB",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  detailDirectionsBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  detailAnnsSection: {
    gap: 8,
    marginTop: 4,
  },
  detailAnnItem: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    gap: 2,
  },
  detailAnnTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  detailAnnBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  detailScrollContent: {
    gap: 8,
    paddingBottom: 36,
  },
  detailInvSection: {
    marginTop: 4,
    gap: 8,
  },
  detailSectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  detailInvChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  detailInvChip: {
    backgroundColor: "#EFF6FF",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  detailInvChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2563EB",
  },
  detailInvEmpty: {
    fontSize: 13,
    fontStyle: "italic",
  },
});
