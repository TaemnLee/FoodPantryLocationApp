import Constants from "expo-constants";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";

import type { PantryLocationSeed } from "@/types/pantry";

type PantryMapLocation = PantryLocationSeed & {
  latitude: number;
  longitude: number;
};

const pantrySeed = require("@/data/pantries.json") as PantryLocationSeed[];

const LICKING_COUNTY_REGION: Region = {
  latitude: 40.08,
  longitude: -82.48,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

const googleMapsApiKey =
  Constants.expoConfig?.android?.config?.googleMaps?.apiKey ??
  Constants.expoConfig?.extra?.googleMapsApiKey ??
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

const formatAddress = (pantry: PantryLocationSeed) =>
  `${pantry.street}, ${pantry.city}, ${pantry.state} ${pantry.zip}`;

async function geocodePantry(pantry: PantryLocationSeed, apiKey: string) {
  const query = encodeURIComponent(formatAddress(pantry));
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${apiKey}`
  );
  const payload = await response.json();

  if (!response.ok || payload.status !== "OK" || !payload.results?.[0]?.geometry?.location) {
    return null;
  }

  const { lat, lng } = payload.results[0].geometry.location;
  return {
    ...pantry,
    latitude: lat,
    longitude: lng,
  } satisfies PantryMapLocation;
}

export default function MapScreen() {
  const [pantries, setPantries] = useState<PantryMapLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCoordinates() {
      if (!googleMapsApiKey) {
        if (active) {
          setErrorMessage("Google Maps API key is missing.");
          setIsLoading(false);
        }
        return;
      }

      const mapped: PantryMapLocation[] = [];
      for (const pantry of pantrySeed) {
        try {
          const geocoded = await geocodePantry(pantry, googleMapsApiKey);
          if (geocoded) {
            mapped.push(geocoded);
          }
        } catch {
          // Ignore single-location failures to keep map usable.
        }
      }

      if (active) {
        setPantries(mapped);
        if (!mapped.length) {
          setErrorMessage("No pantry coordinates found. Check geocoding/API setup.");
        }
        setIsLoading(false);
      }
    }

    loadCoordinates();
    return () => {
      active = false;
    };
  }, []);

  const markerDescription = useMemo(
    () =>
      Object.fromEntries(
        pantries.map((pantry) => [
          pantry.id,
          `${pantry.street}, ${pantry.city}, ${pantry.state} ${pantry.zip}`,
        ])
      ),
    [pantries]
  );

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={LICKING_COUNTY_REGION}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}>
        {pantries.map((pantry) => (
          <Marker
            key={pantry.id}
            coordinate={{ latitude: pantry.latitude, longitude: pantry.longitude }}
            title={pantry.name}
            description={markerDescription[pantry.id]}
          />
        ))}
      </MapView>

      {isLoading ? (
        <View style={styles.overlay}>
          <ActivityIndicator size="small" />
          <Text style={styles.overlayText}>Geocoding pantry addresses...</Text>
        </View>
      ) : null}

      {!isLoading && errorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}
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
  overlay: {
    position: "absolute",
    alignSelf: "center",
    bottom: 24,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  overlayText: {
    color: "#FFFFFF",
    fontSize: 13,
  },
  errorBanner: {
    position: "absolute",
    top: 24,
    left: 16,
    right: 16,
    borderRadius: 10,
    backgroundColor: "#B42318",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: "#FFFFFF",
    fontSize: 13,
  },
});
