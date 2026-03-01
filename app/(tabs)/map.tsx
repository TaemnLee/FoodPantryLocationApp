import * as Location from "expo-location";
import { useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";

import type { PantryLocation } from "@/types/pantry";

const pantries = require("@/data/pantries.json") as PantryLocation[];

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
  const [userCoords, setUserCoords] = useState<UserCoords | null>(null);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== "granted") return;
      Location.getCurrentPositionAsync({}).then(({ coords }) => {
        setUserCoords({ latitude: coords.latitude, longitude: coords.longitude });
      });
    });
  }, []);

  const nearest = useMemo(() => {
    if (!userCoords) return null;
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
  }, [userCoords]);

  function openDirections(pantry: PantryLocation) {
    const { latitude, longitude } = pantry;
    const url =
      Platform.OS === "ios"
        ? `maps://?daddr=${latitude},${longitude}`
        : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
    Linking.openURL(url);
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
            key={pantry.id}
            coordinate={{ latitude: pantry.latitude, longitude: pantry.longitude }}
            title={pantry.name}
            description={`${pantry.street}, ${pantry.city}, ${pantry.state} ${pantry.zip}`}
          />
        ))}
      </MapView>

      {nearest && (
        <View style={styles.card}>
          <View style={styles.cardBody}>
            <Text style={styles.cardLabel}>Nearest pantry</Text>
            <Text style={styles.cardName} numberOfLines={1}>{nearest.pantry.name}</Text>
            <Text style={styles.cardAddress} numberOfLines={1}>
              {nearest.pantry.street}, {nearest.pantry.city}
            </Text>
          </View>
          <View style={styles.cardSide}>
            <Text style={styles.cardDistance}>{nearest.miles.toFixed(1)} mi</Text>
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
  map: {
    flex: 1,
  },
  card: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: "#FFFFFF",
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
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  cardAddress: {
    fontSize: 13,
    color: "#6B7280",
  },
  cardSide: {
    alignItems: "flex-end",
    gap: 8,
    marginLeft: 12,
  },
  cardDistance: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
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
