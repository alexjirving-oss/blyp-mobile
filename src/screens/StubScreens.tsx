import React, { useCallback, useRef, useState } from 'react';
import { Alert, ActivityIndicator, KeyboardAvoidingView, Modal, Platform, StyleSheet, SafeAreaView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HeaderContainer from '../components/HeaderContainer';
import BlypLogo from '../components/BlypLogo';
import { useTheme } from '../styles/ThemeProvider';
import type { ThemeMode } from '../styles/designSystem/palettes';
import { Linking } from 'react-native';
import { db, auth, firebaseEnabled } from '../config/firebase';
import { creditEconomyCoinsAdmin, makeIdempotencyKey } from '../api/economyLiveApi';
import { WALLETS_COLLECTION } from '../config/economyModel';
import { useAuth, hardLogout } from '../hooks/useCommon';
import { requestReplayTour } from '../tour/tourBus';

declare const __DEV__: boolean;

const makeStub = (title: string, message: string) => ({ navigation }: any) => (
  <SafeAreaView style={{ flex: 1, backgroundColor: '#0A0A0C' }}>
    <HeaderContainer onLayout={() => {}}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 }}>
        <BlypLogo style={{}} useGradientBackground={false} textStyle={{ fontSize: 24 }} />
      </View>
    </HeaderContainer>
    <View style={styles.center}> 
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.msg}>{message}</Text>
      <TouchableOpacity style={styles.btn} onPress={()=>navigation.goBack()}><Text style={styles.btnText}>Go back</Text></TouchableOpacity>
    </View>
  </SafeAreaView>
);

export const WalletStub = makeStub('Wallet', 'Wallet/Earnings is not yet available.');

/** Light / Dark / System segmented control wired to the global theme. */
const AppearanceControl = () => {
  const { colors, preference, setMode, radius } = useTheme();
  const options: { key: ThemeMode; label: string; icon: string }[] = [
    { key: 'light', label: 'Light', icon: '☀️' },
    { key: 'dark', label: 'Dark', icon: '🌙' },
    { key: 'system', label: 'System', icon: '⚙️' },
  ];
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 8,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: radius.lg,
        padding: 6,
        marginHorizontal: 12,
        marginBottom: 12,
      }}
    >
      {options.map((opt) => {
        const active = preference === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            onPress={() => setMode(opt.key)}
            activeOpacity={0.85}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 10,
              borderRadius: radius.md,
              backgroundColor: active ? colors.primary : 'transparent',
            }}
          >
            <Text style={{ fontSize: 16, marginBottom: 2 }}>{opt.icon}</Text>
            <Text
              style={{
                color: active ? colors.onBrand : colors.textSecondary,
                fontWeight: active ? '800' : '600',
                fontSize: 12,
              }}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

export const SettingsStub = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { uid } = useAuth();
  const showDevTools = (__DEV__ === true) || (process.env?.EXPO_PUBLIC_ENABLE_DEVTOOLS === '1');
  const [deleting, setDeleting] = useState(false);

  const openUrl = useCallback((url: string) => {
    Linking.openURL(url).catch(() => Alert.alert('Couldn’t open link', url));
  }, []);

  const requestAccountDeletion = useCallback(() => {
    if (!uid) {
      Alert.alert('Sign in required', 'Please sign in to delete your account.');
      return;
    }
    Alert.alert(
      'Delete your account?',
      'This permanently removes your profile, posts and messages. Any coins or earnings are forfeited and this cannot be undone. We complete deletion within 30 days.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'This is your final confirmation. Your account will be scheduled for permanent deletion.',
              [
                { text: 'Keep my account', style: 'cancel' },
                {
                  text: 'Permanently delete',
                  style: 'destructive',
                  onPress: async () => {
                    setDeleting(true);
                    try {
                      if (firebaseEnabled && db && typeof db.collection === 'function') {
                        // Record the request so the backend deletion worker can action it,
                        // and flag the profile so it's immediately treated as deactivated.
                        await db.collection('accountDeletions').doc(uid).set({
                          uid,
                          requestedAt: Date.now(),
                          status: 'requested',
                          source: 'in_app',
                        }, { merge: true });
                        try {
                          await db.collection('users').doc(uid).set({
                            deletionRequested: true,
                            deletionRequestedAt: Date.now(),
                          }, { merge: true });
                        } catch { /* non-fatal */ }
                      }
                    } catch (e: any) {
                      setDeleting(false);
                      Alert.alert('Couldn’t start deletion', e?.message || 'Please try again, or email privacy@blyp.world.');
                      return;
                    }
                    try { await hardLogout(); } catch { /* fall through */ }
                    setDeleting(false);
                    Alert.alert(
                      'Account deletion requested',
                      'You’ve been signed out. Your account and data will be permanently deleted within 30 days. Contact privacy@blyp.world if you need help.'
                    );
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, [uid]);

  const [showCodeModal, setShowCodeModal] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const [showCreditModal, setShowCreditModal] = useState(false);
  const [targetUsername, setTargetUsername] = useState('');
  const [coinsText, setCoinsText] = useState('');
  const [busy, setBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const cleanUsername = useCallback((raw: string) => {
    const s = String(raw || '').trim();
    const noAt = s.startsWith('@') ? s.slice(1) : s;
    // Firestore queries are case-sensitive; do not lowercase here.
    return noAt.trim();
  }, []);

  const parseCoins = useCallback((raw: string) => {
    const n = Number(String(raw || '').trim());
    if (!Number.isFinite(n)) return null;
    const i = Math.trunc(n);
    if (String(i) !== String(Math.trunc(n))) return null;
    if (i < 1 || i > 1_000_000) return null;
    return i;
  }, []);

  const findTargetUserSubByUsername = useCallback(async (usernameRaw: string): Promise<string> => {
    if (!firebaseEnabled) {
      throw new Error('Firebase is not enabled; cannot resolve username.');
    }

    const username = cleanUsername(usernameRaw);
    if (!username) {
      throw new Error('Username is required.');
    }

    const snap = await db.collection('users').where('username', '==', username).limit(1).get();
    const doc = snap?.docs?.[0];
    if (!doc) {
      throw new Error('User not found.');
    }
    const data: any = typeof doc.data === 'function' ? doc.data() : (doc as any).data;

    // Prefer explicit sub fields if present.
    const candidates = [
      data?.cognitoSub,
      data?.sub,
      data?.uid,
      data?.userId,
      data?.cognito_sub,
      data?.cognito_sub_id,
    ];
    for (const c of candidates) {
      const v = typeof c === 'string' ? c.trim() : '';
      if (v) return v;
    }

    // Evidence in ProfileScreen.v3.tsx indicates users/{uid} is keyed by Cognito sub.
    return String(doc.id);
  }, [cleanUsername]);

  const mirrorBalanceToFirestoreWallet = useCallback(async (targetUserId: string, newBalance: number) => {
    // The server-authoritative wallet lives in Postgres (live-service).
    // This devtools action also mirrors the balance into the legacy Firestore wallet doc
    // so the existing UI (which subscribes to Firestore) updates immediately.
    if (!firebaseEnabled) return;
    const canUseCompatApi = typeof (db as any)?.collection === 'function';
    if (!canUseCompatApi) return;

    const id = String(targetUserId || '').trim();
    if (!id) return;

    const n = Number(newBalance);
    if (!Number.isFinite(n)) return;

    try {
      await (db as any)
        .collection(WALLETS_COLLECTION)
        .doc(id)
        .set(
          {
            balance: n,
            lastUpdated: new Date(),
          },
          { merge: true }
        );
    } catch (e: any) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[DEVTOOLS] failed to mirror Firestore wallet balance', e?.message || String(e));
      }
    }
  }, []);

  const resetCreditModal = useCallback(() => {
    setTargetUsername('');
    setCoinsText('');
    setBusy(false);
    try { abortRef.current?.abort(); } catch {}
    abortRef.current = null;
  }, []);

  const onOpenDeveloperCode = useCallback(() => {
    setDevCode('');
    setCodeError(null);
    setShowCodeModal(true);
  }, []);

  const onContinueCode = useCallback(() => {
    setCodeError(null);
    if (String(devCode || '').trim() !== '369') {
      setCodeError('Incorrect code.');
      return;
    }
    setShowCodeModal(false);
    setDevCode('');
    setCodeError(null);
    setShowCreditModal(true);
  }, [devCode]);

  const onCancelCredit = useCallback(() => {
    setShowCreditModal(false);
    resetCreditModal();
  }, [resetCreditModal]);

  const onAddCoins = useCallback(async () => {
    if (busy) return;
    const coins = parseCoins(coinsText);
    const username = cleanUsername(targetUsername);
    if (!username) {
      Alert.alert('Error', 'Enter a username.');
      return;
    }
    if (!coins) {
      Alert.alert('Error', 'Coins must be an integer between 1 and 1,000,000.');
      return;
    }

    setBusy(true);
    abortRef.current = new AbortController();
    try {
      const targetUserId = await findTargetUserSubByUsername(username);
      const idempotencyKey = makeIdempotencyKey('admin-credit');

      const result = await creditEconomyCoinsAdmin(
        { targetUserId, coins, idempotencyKey, reason: 'devtools' },
        { signal: abortRef.current.signal }
      );

      await mirrorBalanceToFirestoreWallet(targetUserId, result.newBalance);

      Alert.alert(
        'Success',
        `Credited ${result.coinsCredited} coins to @${username}.\nUserId: ${targetUserId}\nNew balance: ${result.newBalance}`
      );
      setShowCreditModal(false);
      resetCreditModal();
    } catch (e: any) {
      const baseMsg = String(e?.message || 'Failed to add coins.');
      const httpStatus = e?.httpStatus;
      const code = e?.code;
      const detail = e?.detail;

      // Dev-only diagnostics for backend errors.
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[DEVTOOLS] admin credit failed', {
          httpStatus,
          code,
          detail,
          message: baseMsg,
        });
      }

      let msg = baseMsg;
      if (__DEV__ && detail !== undefined) {
        try {
          msg = `${baseMsg}\n\nDETAIL: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
        } catch {
          msg = baseMsg;
        }
      }

      Alert.alert('Error', msg);
      setBusy(false);
    }
  }, [busy, cleanUsername, coinsText, findTargetUserSubByUsername, mirrorBalanceToFirestoreWallet, parseCoins, resetCreditModal, targetUsername]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <HeaderContainer onLayout={() => {}}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 }}>
          <BlypLogo style={{}} useGradientBackground={false} textStyle={{ fontSize: 24 }} />
        </View>
      </HeaderContainer>

      <View style={styles.screen}>
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Appearance</Text>
        </View>
        <AppearanceControl />

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Account &amp; Privacy</Text>

          <TouchableOpacity
            style={[styles.rowPressable, { borderTopColor: colors.divider }]}
            onPress={() => {
              try { navigation.navigate('PrivacySettings'); } catch { /* ignore */ }
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>Privacy settings</Text>
              <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>Consent, export, and deletion requests</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.rowPressable, { borderTopColor: colors.divider }]}
            onPress={() => {
              try { navigation.navigate('NotificationSettings'); } catch { /* ignore */ }
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>Notification settings</Text>
              <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>Push permission for this device</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.rowPressable, { borderTopColor: colors.divider }]}
            onPress={() => {
              try {
                navigation.goBack();
              } catch { /* ignore */ }
              setTimeout(() => {
                requestReplayTour({ source: 'settings' });
              }, 280);
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>Replay tour</Text>
              <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>Walk through Home, Create, Live, Messages again</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.rowPressable, { borderTopColor: colors.divider }]} onPress={() => openUrl('https://blyp.world/privacy')}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>Privacy Policy</Text>
              <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>How we handle your data</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.rowPressable, { borderTopColor: colors.divider }]} onPress={() => openUrl('https://blyp.world/terms')}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>Terms &amp; Community Guidelines</Text>
              <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>The rules everyone agrees to</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.rowPressable, { borderTopColor: colors.divider }]}
            onPress={requestAccountDeletion}
            disabled={deleting}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: '#FF6B60' }]}>{deleting ? 'Processing…' : 'Delete my account'}</Text>
              <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>Permanently remove your account and data</Text>
            </View>
            {deleting ? <ActivityIndicator color="#FF6B60" /> : null}
          </TouchableOpacity>
        </View>

        {showDevTools ? (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Developer</Text>
            <TouchableOpacity style={[styles.rowPressable, { borderTopColor: colors.divider }]} onPress={onOpenDeveloperCode}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>Developer Code</Text>
                <Text style={[styles.rowSubtitle, { color: colors.textMuted }]}>Enter code to unlock developer tools</Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary, alignSelf: 'center', marginTop: 12 }]} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Go back</Text>
        </TouchableOpacity>
      </View>

      {/* Modal #1: code entry */}
      <Modal visible={showCodeModal} transparent animationType="fade" onRequestClose={() => setShowCodeModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Developer Code</Text>
            <TextInput
              value={devCode}
              onChangeText={(t) => { setDevCode(t); setCodeError(null); }}
              placeholder="Enter code"
              placeholderTextColor="#A1A1AA"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            {codeError ? <Text style={styles.errorText}>{codeError}</Text> : null}
            <View style={styles.modalBtns}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnSecondary]} onPress={() => { setShowCodeModal(false); setDevCode(''); setCodeError(null); }}>
                <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={onContinueCode}>
                <Text style={styles.modalBtnTextPrimary}>Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal #2: admin credit */}
      <Modal visible={showCreditModal} transparent animationType="fade" onRequestClose={onCancelCredit}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Coins (Dev)</Text>
            <TextInput
              value={targetUsername}
              onChangeText={setTargetUsername}
              placeholder="Username (e.g. @blyp)"
              placeholderTextColor="#A1A1AA"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              value={coinsText}
              onChangeText={setCoinsText}
              placeholder="Coins (1..1,000,000)"
              placeholderTextColor="#A1A1AA"
              style={styles.input}
              keyboardType="number-pad"
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnSecondary]} disabled={busy} onPress={onCancelCredit}>
                <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} disabled={busy} onPress={onAddCoins}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnTextPrimary}>Add Coins</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};
export const MyVideosStub = makeStub('My Videos', 'Your videos list will appear here.');
export const PastLivesStub = makeStub('Past Live Streams', 'Past live streams are coming soon.');
export const LiveUnavailableStub = makeStub('Live Unavailable', 'Live streaming is not available yet.');

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  msg: { color: '#D4D4D8', textAlign: 'center', marginBottom: 16 },
  btn: { backgroundColor: '#00D2BE', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  btnText: { color: '#0A0A0C', fontWeight: '800' },

  screen: { flex: 1, padding: 16 },
  section: { marginBottom: 16, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, overflow: 'hidden' },
  sectionTitle: { color: '#D4D4D8', fontSize: 13, fontWeight: '700', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  row: { paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(148,163,184,0.25)' },
  rowPressable: { paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(148,163,184,0.25)' },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 2 },
  rowSubtitle: { color: '#A1A1AA', fontSize: 13 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: '#141418', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  input: { width: '100%', borderWidth: 1, borderColor: 'rgba(148,163,184,0.25)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.03)' },
  errorText: { color: '#fca5a5', marginBottom: 8, fontWeight: '700' },
  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  modalBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, minWidth: 110, alignItems: 'center', justifyContent: 'center' },
  modalBtnPrimary: { backgroundColor: '#00D2BE', marginLeft: 10 },
  modalBtnSecondary: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  modalBtnTextPrimary: { color: '#0A0A0C', fontWeight: '800' },
  modalBtnTextSecondary: { color: '#D4D4D8', fontWeight: '800' },
});

export default WalletStub;
