/**
 * Frenemies Rules — mandatory on every host/guest/viewer game surface.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const TEAL = '#FF2D55';
const GOLD = '#F5C542';
const GOLD_SOFT = '#FDE68A';
const INK = '#0A0A0C';

const STEPS = [
  {
    n: '1',
    title: 'What it is',
    body: 'Frenemies is Blyp’s live party show: an 11-box prize wheel, guests on stage, and the room racing empty boxes for a chance to throw.',
  },
  {
    n: '2',
    title: 'The wheel',
    body: 'Eleven boxes. Occupied boxes show who’s on stage. Empty boxes glow for the audience.',
  },
  {
    n: '3',
    title: 'Occupied land',
    body: 'That guest becomes Chooser — they pick another guest to throw off stage for coins.',
  },
  {
    n: '4',
    title: 'Empty land',
    body: 'Everyone can compete: quiz, chat phrase, or likes race. Winner becomes Chooser if anyone is left to throw.',
  },
  {
    n: '5',
    title: 'Coins',
    body: null, // filled live
  },
  {
    n: '6',
    title: 'Timeouts',
    body: 'Hesitate as Chooser and you’re thrown out with no coins. Challenge timeouts award nobody.',
  },
  {
    n: '7',
    title: 'Host conducts',
    body: 'The host taps Spin each round (unless Auto mode is on). Opening the show does not auto-spin. Auto mode auto-spins on an interval and fills/drops seats each round.',
  },
  {
    n: '8',
    title: 'Queue & seats',
    body: 'Request to join from the show or guest CTA — fair FIFO queue. After each round settles, one eligible player may auto-drop and the next queued person is seated.',
  },
  {
    n: '9',
    title: 'Jump in · 50 coins',
    body: 'Viewers can pay 50 coins (Ready phase only) to kick an eligible guest and take their box. You are forced onto stage — pay never means decline. First-spin protected guests and anyone with an extra life cannot be jumped.',
  },
  {
    n: '10',
    title: 'Extra life · 50 coins',
    body: 'Seated guests can buy one extra life. It absorbs the next throw, auto-drop, or chooser timeout. Host moderation kick still removes you. Lives reset when you leave the stage.',
  },
  {
    n: '11',
    title: 'First spin & cooldown',
    body: 'New seats are protected until the wheel lands once while they are on stage. Just-dropped players sit out at least one full round before they can return.',
  },
];

export default function FrenemiesRulesSheet({
  visible,
  onClose,
  throwCoins = 10,
  soloCoins = 10,
  payer = 'host',
  isHost = false,
  autoContinue = false,
  spinSec = 15,
}) {
  const coinStep = `Throw reward ${throwCoins} · Solo challenge win ${soloCoins} · Paid by ${
    payer === 'house' ? 'House' : 'Host'
  } (spendable coins).`;

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop} pointerEvents="box-none">
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
          accessibilityLabel="Dismiss rules"
        />
        <View style={styles.sheet} pointerEvents="auto">
          <LinearGradient
            colors={['#0E3D38', '#0A0A0C', '#1A1520']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.grad}
          >
            <View style={styles.topRow}>
              <View>
                <Text style={styles.kicker} allowFontScaling={false}>
                  FRENEMIES
                </Text>
                <Text style={styles.title} allowFontScaling={false}>
                  How it works
                </Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
                <Text style={styles.closeText} allowFontScaling={false}>
                  Close
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scroll}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {STEPS.map((step) => (
                <View key={step.n} style={styles.step}>
                  <View style={styles.numBadge}>
                    <Text style={styles.numText} allowFontScaling={false}>
                      {step.n}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stepTitle} allowFontScaling={false}>
                      {step.title}
                    </Text>
                    <Text style={styles.stepBody} allowFontScaling={false}>
                      {step.n === '5' ? coinStep : step.body}
                    </Text>
                  </View>
                </View>
              ))}

              <View style={styles.metaCard}>
                <Text style={styles.metaLine} allowFontScaling={false}>
                  Spin · {spinSec}s default this show
                </Text>
                <Text style={styles.metaLine} allowFontScaling={false}>
                  Auto mode · {autoContinue ? 'ON' : 'OFF'}
                </Text>
                {isHost ? (
                  <Text style={[styles.metaLine, { color: GOLD_SOFT }]} allowFontScaling={false}>
                    You conduct — tap Spin when the room is ready.
                  </Text>
                ) : null}
              </View>
            </ScrollView>
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  sheet: {
    maxHeight: '82%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,45,85,0.45)',
    zIndex: 2,
    elevation: 8,
  },
  grad: { padding: 16, maxHeight: '100%' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  kicker: { color: TEAL, fontWeight: '900', fontSize: 10, letterSpacing: 2.2 },
  title: { color: GOLD_SOFT, fontWeight: '900', fontSize: 22, marginTop: 2 },
  closeBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  closeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  scroll: { maxHeight: 420 },
  step: { flexDirection: 'row', gap: 10, marginBottom: 12, alignItems: 'flex-start' },
  numBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { color: INK, fontWeight: '900', fontSize: 13 },
  stepTitle: { color: '#fff', fontWeight: '900', fontSize: 14 },
  stepBody: {
    color: 'rgba(244,247,250,0.78)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    fontWeight: '600',
  },
  metaCard: {
    marginTop: 4,
    marginBottom: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,45,85,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,45,85,0.28)',
    gap: 4,
  },
  metaLine: { color: TEAL, fontWeight: '800', fontSize: 12 },
});
