import { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Pressable, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useThemeColor } from '@/hooks/use-theme-color';
import { supabase } from '@/lib/supabase';

export default function HomeScreen() {
  const router = useRouter();
  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'icon');
  const cardBg = useThemeColor({ light: '#F3F4F6', dark: '#1F2937' }, 'background');
  const separatorColor = useThemeColor({ light: '#E5E7EB', dark: '#374151' }, 'background');
  const inputBg = useThemeColor({ light: '#F9FAFB', dark: '#111827' }, 'background');
  const borderColor = useThemeColor({ light: '#E5E7EB', dark: '#374151' }, 'background');

  const [pantryCount, setPantryCount] = useState<number | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    supabase
      .from('pantry_location')
      .select('*', { count: 'exact', head: true })
      .then(({ count }) => { if (count !== null) setPantryCount(count); });
  }, []);

  function handleSignIn() {
    setShowSignIn(false);
    setEmail('');
    setPassword('');
    router.push('/admin');
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.main}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Licking County, OH</Text>
          </View>

          <Text style={[styles.title, { color: textColor }]}>Pantry{'\n'}Locator</Text>

          <Text style={[styles.subtitle, { color: mutedColor }]}>
            Find food pantries near you — hours, locations, and directions all in one place.
          </Text>

          <View style={[styles.divider, { backgroundColor: separatorColor }]} />

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: textColor }]}>{pantryCount ?? '—'}</Text>
              <Text style={[styles.statLabel, { color: mutedColor }]}>Pantries</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: separatorColor }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: textColor }]}>Free</Text>
              <Text style={[styles.statLabel, { color: mutedColor }]}>Always</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: separatorColor }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: textColor }]}>Live</Text>
              <Text style={[styles.statLabel, { color: mutedColor }]}>Hours</Text>
            </View>
          </View>
        </View>

        <View style={[styles.ctaCard, { backgroundColor: cardBg }]}>
          <View style={styles.ctaIconCircle}>
            <Text style={styles.ctaIcon}>🗺️</Text>
          </View>
          <View style={styles.ctaTextBlock}>
            <Text style={[styles.ctaTitle, { color: textColor }]}>Find pantries near you</Text>
            <Text style={[styles.ctaSubtitle, { color: mutedColor }]}>
              Tap the Map tab below to explore locations
            </Text>
          </View>
          <Text style={[styles.ctaArrow, { color: mutedColor }]}>↓</Text>
        </View>

        <Pressable style={styles.adminLink} onPress={() => setShowSignIn(true)}>
          <Text style={[styles.adminLinkText, { color: mutedColor }]}>Admin</Text>
        </Pressable>
      </View>

      <Modal
        visible={showSignIn}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSignIn(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowSignIn(false)} />
          <View style={[styles.signInCard, { backgroundColor }]}>
            <Text style={[styles.signInTitle, { color: textColor }]}>Admin Sign In</Text>
            <Text style={[styles.signInSubtitle, { color: mutedColor }]}>
              For authorized personnel only
            </Text>

            <View style={styles.signInFields}>
              <TextInput
                style={[styles.signInInput, { backgroundColor: inputBg, borderColor, color: textColor }]}
                placeholder="Email"
                placeholderTextColor={mutedColor}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
              />
              <TextInput
                style={[styles.signInInput, { backgroundColor: inputBg, borderColor, color: textColor }]}
                placeholder="Password"
                placeholderTextColor={mutedColor}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleSignIn}
              />
            </View>

            <Pressable
              style={({ pressed }) => [styles.signInBtn, pressed && styles.signInBtnPressed]}
              onPress={handleSignIn}>
              <Text style={styles.signInBtnText}>Sign In</Text>
            </Pressable>

            <Pressable style={styles.cancelBtn} onPress={() => setShowSignIn(false)}>
              <Text style={[styles.cancelBtnText, { color: mutedColor }]}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  main: {
    flex: 1,
    justifyContent: 'center',
    gap: 20,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#2563EB',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 56,
    fontWeight: '800',
    lineHeight: 60,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 17,
    lineHeight: 26,
    fontWeight: '400',
  },
  divider: { height: 1, marginVertical: 4 },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statNumber: { fontSize: 24, fontWeight: '700' },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: { width: 1, height: 36 },
  ctaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  ctaIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaIcon: { fontSize: 22 },
  ctaTextBlock: { flex: 1, gap: 2 },
  ctaTitle: { fontSize: 15, fontWeight: '700' },
  ctaSubtitle: { fontSize: 13 },
  ctaArrow: { fontSize: 20, fontWeight: '300' },
  adminLink: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  adminLinkText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Sign-in modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  signInCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 28,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  signInTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  signInSubtitle: {
    fontSize: 14,
    marginBottom: 8,
  },
  signInFields: { gap: 12, marginTop: 4 },
  signInInput: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  signInBtn: {
    height: 52,
    backgroundColor: '#2563EB',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  signInBtnPressed: { opacity: 0.85 },
  signInBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
