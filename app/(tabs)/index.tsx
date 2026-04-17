import { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { Animated, StyleSheet, View, Text, Pressable, Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Image, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useThemeColor } from '@/hooks/use-theme-color';
import { supabase } from '@/lib/supabase';

export default function HomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'icon');
  const cardBg = useThemeColor({ light: '#F3F4F6', dark: '#1F2937' }, 'background');
  const separatorColor = useThemeColor({ light: '#E5E7EB', dark: '#374151' }, 'background');
  const inputBg = useThemeColor({ light: '#F9FAFB', dark: '#111827' }, 'background');
  const borderColor = useThemeColor({ light: '#E5E7EB', dark: '#374151' }, 'background');

  const [pantryCount, setPantryCount] = useState<number | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function openSignIn() {
    setSheetVisible(true);
    sheetAnim.setValue(0);
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, bounciness: 4 }).start();
  }

  function closeSignIn() {
    Animated.timing(sheetAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setSheetVisible(false);
      setEmail('');
      setPassword('');
    });
  }

  useFocusEffect(useCallback(() => {
    supabase
      .from('pantry_location')
      .select('*', { count: 'exact', head: true })
      .then(({ count }) => { if (count !== null) setPantryCount(count); });
  }, []));

  async function handleSignIn() {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      Alert.alert('Sign In Failed', error.message);
      return;
    }
    closeSignIn();
    router.push('/admin');
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.main}>
          <Image
            source={require('@/assets/images/fpn-logo.png')}
            style={[styles.logo, colorScheme === 'dark' && { tintColor: '#FFFFFF' }]}
            resizeMode="contain"
          />

          <Text style={[styles.title, { color: textColor }]} numberOfLines={1} adjustsFontSizeToFit>Pantry Locator</Text>

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

        <Pressable style={styles.adminLink} onPress={async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            router.push('/admin');
          } else {
            openSignIn();
          }
        }}>
          <Text style={[styles.adminLinkText, { color: mutedColor }]}>Admin</Text>
        </Pressable>
      </View>

      <Modal
        visible={sheetVisible}
        transparent
        animationType="none"
        onRequestClose={closeSignIn}>
        <Animated.View style={[styles.modalOverlay, { opacity: sheetAnim }]} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSignIn} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            pointerEvents="box-none">
            <Animated.View
              style={[
                styles.signInCard,
                { backgroundColor, transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }] },
              ]}>
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

              <Pressable style={styles.cancelBtn} onPress={closeSignIn}>
                <Text style={[styles.cancelBtnText, { color: mutedColor }]}>Cancel</Text>
              </Pressable>
            </Animated.View>
          </KeyboardAvoidingView>
        </Animated.View>
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
  logo: {
    width: 200,
    height: 130,
    alignSelf: 'center',
  },
  title: {
    fontSize: 56,
    fontWeight: '800',
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
    paddingVertical: 7,
    paddingHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(107,114,128,0.4)',
  },
  adminLinkText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Sign-in modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
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
