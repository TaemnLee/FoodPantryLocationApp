import { Platform, StyleSheet, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";

import type { PantryLocation } from "@/types/pantry";

const pantries = require("@/data/pantries.json") as PantryLocation[];

const LICKING_COUNTY_REGION: Region = {
  latitude: 40.08,
  longitude: -82.48,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

export default function MapScreen() {
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
            description={`${pantry.street}, ${pantry.city}, ${pantry.state} ${pantry.zip}`}
          />
        ))}
      </MapView>
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
});
