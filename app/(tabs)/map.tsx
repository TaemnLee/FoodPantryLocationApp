import * as Location from "expo-location";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemeColor } from "@/hooks/use-theme-color";
import { supabase } from "@/lib/supabase";
import type { PantryLocation } from "@/types/pantry";

/** Height reserved for map provider logo (Apple/Google) at bottom. Not exposed by SDK. */
const MAP_LOGO_BOTTOM = 16;

const LICKING_COUNTY_REGION: Region = {
  latitude: 40.08,
  longitude: -82.48,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

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
  const [userCoords, setUserCoords] = useState<UserCoords | null>(null);
  const [pantries, setPantries] = useState<PantryLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const cardBg = useThemeColor({}, "background");
  const cardBottom = 16 + insets.bottom + MAP_LOGO_BOTTOM;
  const cardText = useThemeColor({}, "text");
  const cardMuted = useThemeColor({}, "icon");

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from("pantry_location").select("*");
        if (error) {
          console.error("Supabase error:", error);
          return;
        }
        console.log("Pantries loaded:", data?.length ?? 0, data?.[0]);
        setPantries(data ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== "granted") return;
      Location.getCurrentPositionAsync({}).then(({ coords }) => {
        setUserCoords({ latitude: coords.latitude, longitude: coords.longitude });
      });
    });
  }, []);

  const nearest = useMemo(() => {
    if (!userCoords || pantries.length === 0) return null;
    let closest = pantries[0];
    let minDist = distanceMiles(userCoords.latitude, userCoords.longitude, closest.latitude, closest.longitude);
    for (const pantry of pantries.slice(1)) {
      const d = distanceMiles(userCoords.latitude, userCoords.longitude, pantry.latitude, pantry.longitude);
      if (d < minDist) {
        minDist = d;
        closest = pantry;
      }
    }
    return { pantry: closest, miles: minDist };
  }, [userCoords, pantries]);

  function openDirections(pantry: PantryLocation) {
    const { latitude, longitude } = pantry;
    const url =
      Platform.OS === "ios"
        ? `maps://?daddr=${latitude},${longitude}`
        : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
    Linking.openURL(url);
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
        style={styles.map}
        initialRegion={LICKING_COUNTY_REGION}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        showsUserLocation={!!userCoords}
        showsMyLocationButton={!!userCoords}>
        {pantries.map((pantry) => (
          <Marker
            key={pantry.pantry_id}
            coordinate={{ latitude: pantry.latitude, longitude: pantry.longitude }}
            title={pantry.name}
            description={`${pantry.street}, ${pantry.city}, ${pantry.state} ${pantry.zip}`}
          />
        ))}
      </MapView>

      {nearest && (
        <View style={[styles.card, { backgroundColor: cardBg, bottom: cardBottom }]}>
          <View style={styles.cardBody}>
            <Text style={[styles.cardLabel, { color: cardMuted }]}>Nearest pantry</Text>
            <Text style={[styles.cardName, { color: cardText }]} numberOfLines={1}>{nearest.pantry.name}</Text>
            <Text style={[styles.cardAddress, { color: cardMuted }]} numberOfLines={1}>
              {nearest.pantry.street}, {nearest.pantry.city}
            </Text>
          </View>
          <View style={styles.cardSide}>
            <Text style={[styles.cardDistance, { color: cardText }]}>{nearest.miles.toFixed(1)} mi</Text>
            <Pressable
              style={styles.directionsBtn}
              onPress={() => openDirections(nearest.pantry)}>
              <Text style={styles.directionsBtnText}>Directions</Text>
            </Pressable>
          </View>
        </View>
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
    position: "absolute",
    left: 16,
    right: 16,
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
});
