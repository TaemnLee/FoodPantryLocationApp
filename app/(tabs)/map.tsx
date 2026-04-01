import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import {
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
import MapView, { Callout, Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemeColor } from "@/hooks/use-theme-color";
import { supabase } from "@/lib/supabase";
import type { PantryLocation, PantryOpHours } from "@/types/pantry";

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

const TIME_PRESETS = [
  { label: "8 AM", value: "08:00" },
  { label: "10 AM", value: "10:00" },
  { label: "12 PM", value: "12:00" },
  { label: "2 PM", value: "14:00" },
  { label: "4 PM", value: "16:00" },
  { label: "6 PM", value: "18:00" },
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
  const markerRefs = useRef<Record<string, { showCallout?: () => void } | null>>({});
  const [markerModalPantry, setMarkerModalPantry] = useState<PantryLocation | null>(null);
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
  const [expandedFilter, setExpandedFilter] = useState<"day" | "distance" | "time" | null>(null);
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

    const openNow = pantries.filter(isOpenNow).sort(byDist);
    if (openNow.length) {
      const p = openNow[0];
      return { pantry: p, miles: dist(p), label: "Nearest open now" as const };
    }

    const openToday = pantries.filter(opensLaterToday).sort(byDist);
    if (openToday.length) {
      const p = openToday[0];
      return { pantry: p, miles: dist(p), label: "Nearest open today" as const };
    }

    const closest = pantries.reduce((a, b) => (dist(a) < dist(b) ? a : b));
    return { pantry: closest, miles: dist(closest), label: "Nearest pantry" as const };
  }, [userCoords, pantries]);

  const displayPantry = nearest?.pantry ?? null;
  const displayLabel = nearest?.label ?? "Nearest pantry";
  const displayMiles =
    displayPantry && userCoords
      ? distanceMiles(userCoords.latitude, userCoords.longitude, displayPantry.latitude, displayPantry.longitude)
      : null;

async function fetchPantries() {
  try {
    const [{ data: locations, error: locError }, { data: hours, error: hoursError }] =
      await Promise.all([
        supabase.from("pantry_location").select("*"),
        supabase.from("pantry_op_hours").select("*"),
      ]);

    if (locError) {
      console.error("Supabase pantry_location error:", locError);
      return;
    }

    if (hoursError) {
      console.warn("Supabase pantry_op_hours error (hours not loaded):", hoursError);
    }

    const allHours = hours ?? [];

    const pantriesWithHours = (locations ?? []).map((p) => ({
      ...p,
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
}, []);

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
          const { isOpen, closingTime, nextOpens } = getOpenStatus(pantry);
          const statusText = isOpen
            ? closingTime
              ? `Open until ${closingTime}`
              : "Open"
            : nextOpens ?? "Closed";

          return (
            <Marker
              ref={(ref) => {
                markerRefs.current[pantry.pantry_id] = ref;
              }}
              key={pantry.pantry_id}
              coordinate={{ latitude: pantry.latitude, longitude: pantry.longitude }}
              title={pantry.name}
              description={Platform.OS === "ios" ? `${pantry.street}, ${pantry.city}` : undefined}
              onPress={() => {
                if (Platform.OS === "android") {
                  setMarkerModalPantry(pantry);
                }
              }}
              onCalloutPress={() => openDirections(pantry)}>
              {Platform.OS === "ios" && (
                <Callout tooltip>
                  <View style={[styles.callout, { backgroundColor: cardBg }]}>
                    <Text style={[styles.calloutName, { color: cardText }]} numberOfLines={1}>
                      {pantry.name}
                    </Text>
                    <Text style={[styles.calloutAddress, { color: cardMuted }]} numberOfLines={1}>
                      {pantry.street}, {pantry.city}
                    </Text>
                    <Text
                      style={[
                        styles.calloutStatus,
                        { color: isOpen ? "#16a34a" : "#dc2626" },
                      ]}>
                      {statusText}
                    </Text>
                    <View style={styles.calloutDirectionsBtn}>
                      <Text style={styles.calloutDirectionsBtnText}>Directions</Text>
                    </View>
                  </View>
                </Callout>
              )}
            </Marker>
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
              if (next) { setFilterDay(null); setFilterDayLabel(null); setFilterTime(null); }
              setExpandedFilter(null);
            }}>
            <Text style={[styles.filterChipText, chipTextStyle, filterOpenNow && styles.filterChipTextActive]}>
              Open Now
            </Text>
          </Pressable>

          <Pressable
            style={[styles.filterChip, chipStyle, (filterDay !== null || expandedFilter === "day") && styles.filterChipActive]}
            onPress={() => setExpandedFilter(expandedFilter === "day" ? null : "day")}>
            <Text style={[styles.filterChipText, chipTextStyle, (filterDay !== null || expandedFilter === "day") && styles.filterChipTextActive]}>
              {filterDay !== null ? (filterDayLabel ?? WEEKDAY_ABBREV[WEEKDAYS[filterDay]]) : "Day"} ▾
            </Text>
          </Pressable>

          <Pressable
            style={[styles.filterChip, chipStyle, (filterTime !== null || expandedFilter === "time") && styles.filterChipActive]}
            onPress={() => setExpandedFilter(expandedFilter === "time" ? null : "time")}>
            <Text style={[styles.filterChipText, chipTextStyle, (filterTime !== null || expandedFilter === "time") && styles.filterChipTextActive]}>
              {filterTime !== null ? (TIME_PRESETS.find((t) => t.value === filterTime)?.label ?? filterTime) : "Time"} ▾
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

        {expandedFilter === "day" && (
          <View style={[styles.filterPicker, { backgroundColor: cardBg }]}>
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
                    setExpandedFilter(null);
                  }}>
                  <Text style={[styles.filterPickerChipText, chipTextStyle, isActive && styles.filterChipTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {expandedFilter === "time" && (
          <View style={[styles.filterPicker, { backgroundColor: cardBg }]}>
            {TIME_PRESETS.map((preset) => (
              <Pressable
                key={preset.value}
                style={[styles.filterPickerChip, chipStyle, filterTime === preset.value && styles.filterChipActive]}
                onPress={() => {
                  const next = filterTime === preset.value ? null : preset.value;
                  setFilterTime(next);
                  setFilterOpenNow(false);
                  if (next !== null && filterDay === null) {
                    setFilterDay(new Date().getDay());
                    setFilterDayLabel("Today");
                  }
                  setExpandedFilter(null);
                }}>
                <Text style={[styles.filterPickerChipText, chipTextStyle, filterTime === preset.value && styles.filterChipTextActive]}>
                  {preset.label}
                </Text>
              </Pressable>
            ))}
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

      {showSearchDropdown && (
        <Pressable
          style={styles.searchOverlay}
          onPress={() => {
            Keyboard.dismiss();
            setSearchFocused(false);
            setExpandedFilter(null);
          }}
        />
      )}

      {!showSearchDropdown && displayPantry && (() => {
        const { isOpen, closingTime, nextOpens } = getOpenStatus(displayPantry);
        const statusText = isOpen
          ? closingTime ? `Open until ${closingTime}` : "Open"
          : nextOpens ?? "Closed";
        const statusColor = isOpen ? "#16a34a" : "#dc2626";
        return (
          <View style={[styles.bottomCard, { bottom: 8, backgroundColor: cardBg }]}>
            <View style={styles.cardBody}>
              <Text style={[styles.cardLabel, { color: cardMuted }]}>{displayLabel}</Text>
              <Text style={[styles.cardName, { color: cardText }]} numberOfLines={1}>
                {displayPantry.name}
              </Text>
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
              <Pressable style={styles.directionsBtn} onPress={() => openDirections(displayPantry)}>
                <Text style={styles.directionsBtnText}>Directions</Text>
              </Pressable>
            </View>
          </View>
        );
      })()}

      {Platform.OS === "android" && (
        <Modal
          visible={!!markerModalPantry}
          transparent
          animationType="fade"
          onRequestClose={() => setMarkerModalPantry(null)}>
          <Pressable
            style={styles.markerModalOverlay}
            onPress={() => setMarkerModalPantry(null)}>
            {markerModalPantry && (() => {
              const { isOpen, closingTime, nextOpens } = getOpenStatus(markerModalPantry);
              const statusText = isOpen
                ? closingTime ? `Open until ${closingTime}` : "Open"
                : nextOpens ?? "Closed";
              return (
                <Pressable
                  style={[styles.markerModalCard, { backgroundColor: cardBg }]}
                  onPress={(e) => e.stopPropagation()}>
                  <Text style={[styles.markerModalName, { color: cardText }]} numberOfLines={1}>
                    {markerModalPantry.name}
                  </Text>
                  <Text style={[styles.markerModalAddress, { color: cardMuted }]} numberOfLines={1}>
                    {markerModalPantry.street}, {markerModalPantry.city}
                  </Text>
                  <Text
                    style={[
                      styles.markerModalStatus,
                      { color: isOpen ? "#16a34a" : "#dc2626" },
                    ]}>
                    {statusText}
                  </Text>
                  <Pressable
                    style={styles.markerModalDirectionsBtn}
                    onPress={() => {
                      openDirections(markerModalPantry);
                      setMarkerModalPantry(null);
                    }}>
                    <Text style={styles.markerModalDirectionsBtnText}>Directions</Text>
                  </Pressable>
                </Pressable>
              );
            })()}
          </Pressable>
        </Modal>
      )}
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
});
