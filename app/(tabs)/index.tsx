import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function HomeScreen() {
  const backgroundColor = useThemeColor({}, 'background');

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.titleContainer}>
          <ThemedText type="title">Licking County Pantry Network</ThemedText>
        </View>
        <View style={styles.stepContainer}>
          <ThemedText type="subtitle">Welcome</ThemedText>
          <ThemedText>
            This app helps neighbors find nearby food pantries, schedules, and services in Licking
            County.
          </ThemedText>
        </View>
        <View style={styles.stepContainer}>
          <ThemedText type="subtitle">Current Features</ThemedText>
          <ThemedText>- Pantry map tab with address-based markers</ThemedText>
          <ThemedText>- Pantry address dataset from local `data/pantries.json`</ThemedText>
        </View>
        <View style={styles.stepContainer}>
          <ThemedText type="subtitle">Next</ThemedText>
          <ThemedText>
            Add pantry hours/services to the map callouts and store coordinates directly in the data
            file for faster loading.
          </ThemedText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 16,
  },
  titleContainer: {
    gap: 10,
  },
  stepContainer: {
    gap: 8,
  },
});
