// BlypItModal — the "Blyp it" premium AI compose surface.
//
// Give it a command ("wish Ru a happy birthday with a cake pic"), it asks the server
// for message options + an AI image, previews them, and lets the user SEND via the
// native share sheet. Never auto-sends. Handles the premium gate (402 → upsell),
// rate limits, and safety refusals gracefully.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from './Icon';
import {
  composeBlyp,
  markDraftStatus,
  shareMessageText,
  shareImage,
} from '../services/blypItService';

const TEAL = '#FF2D55';

const FRIENDLY_ERROR = {
  subscription_required: {
    title: 'Blyp it is a Plus feature',
    body: 'Upgrade to Blyp Plus to let Blyp draft messages and images for you.',
    cta: 'See plans',
  },
  rate_limited: {
    title: 'Take a breath',
    body: "You've used your Blyp it bursts for now. Try again in a little while.",
  },
  unsafe: {
    title: "Blyp can't help with that one",
    body: 'Let’s keep it kind. Try rephrasing your request.',
  },
  ai_unavailable: {
    title: 'Blyp is having a moment',
    body: 'The assistant is briefly unavailable. Please try again shortly.',
  },
  unauthenticated: {
    title: 'Sign in needed',
    body: 'Please sign in again to use Blyp it.',
  },
  empty_request: {
    title: 'Tell Blyp what to say',
    body: 'Add a quick instruction, like “wish Sam good luck for the exam”.',
  },
  error: {
    title: 'Something went wrong',
    body: 'Please try again.',
  },
};

const BlypItModal = ({ visible, onClose, navigation, initialCommand = '' }) => {
  const [phase, setPhase] = useState('input'); // input | composing | preview | error
  const [command, setCommand] = useState(initialCommand);
  const [draft, setDraft] = useState(null);
  const [selected, setSelected] = useState(0);
  const [errorCode, setErrorCode] = useState(null);
  const [errorDetail, setErrorDetail] = useState(null);

  const reset = useCallback(() => {
    setPhase('input');
    setDraft(null);
    setSelected(0);
    setErrorCode(null);
    setErrorDetail(null);
  }, []);

  useEffect(() => {
    if (visible) {
      setCommand(initialCommand || '');
      reset();
    }
  }, [visible, initialCommand, reset]);

  const close = useCallback(
    async (status) => {
      if (status && draft?.draftId) {
        markDraftStatus(draft.draftId, status).catch(() => {});
      }
      reset();
      setCommand('');
      onClose?.();
    },
    [draft, onClose, reset]
  );

  const runCompose = useCallback(async () => {
    const cmd = String(command || '').trim();
    if (!cmd) {
      setErrorCode('empty_request');
      setPhase('error');
      return;
    }
    setPhase('composing');
    const result = await composeBlyp({ command: cmd });
    if (result.ok) {
      setDraft(result);
      setSelected(0);
      setPhase('preview');
    } else {
      setErrorCode(result.code || 'error');
      setErrorDetail(result.detail || null);
      setPhase('error');
    }
  }, [command]);

  const onSendMessage = useCallback(async () => {
    const text = draft?.messages?.[selected];
    if (!text) return;
    const ok = await shareMessageText(text);
    if (ok) await close('sent');
  }, [draft, selected, close]);

  const onSendImage = useCallback(async () => {
    if (!draft?.imageUrl) return;
    const text = draft?.messages?.[selected];
    const ok = await shareImage(draft.imageUrl, text);
    if (ok) await close('sent');
  }, [draft, selected, close]);

  const renderInput = () => (
    <>
      <Text style={styles.lead}>Tell Blyp what to send, and to whom.</Text>
      <TextInput
        style={styles.input}
        value={command}
        onChangeText={setCommand}
        placeholder='e.g. "Wish Ru a happy birthday with a cake picture"'
        placeholderTextColor="#71717A"
        multiline
        autoFocus
        returnKeyType="go"
        onSubmitEditing={runCompose}
      />
      <TouchableOpacity style={styles.primaryBtn} onPress={runCompose} activeOpacity={0.85}>
        <LinearGradient colors={[TEAL, '#0EA5A0']} style={styles.primaryGradient}>
          <Icon name="sparkles" size={18} color="#062a28" />
          <Text style={styles.primaryText}>Blyp it</Text>
        </LinearGradient>
      </TouchableOpacity>
    </>
  );

  const renderComposing = () => (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={TEAL} />
      <Text style={styles.composingText}>Blyp is drafting…</Text>
    </View>
  );

  const renderPreview = () => (
    <ScrollView showsVerticalScrollIndicator={false}>
      {!!draft?.recipientName && (
        <Text style={styles.recipient}>For {draft.recipientName}</Text>
      )}
      {!!draft?.imageUrl && (
        <Image source={{ uri: draft.imageUrl }} style={styles.image} resizeMode="cover" />
      )}
      <Text style={styles.sectionLabel}>Pick a message</Text>
      {(draft?.messages || []).map((m, i) => (
        <TouchableOpacity
          key={i}
          style={[styles.option, i === selected && styles.optionSelected]}
          onPress={() => setSelected(i)}
          activeOpacity={0.8}
        >
          <Text style={styles.optionText}>{m}</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.primaryBtn} onPress={onSendMessage} activeOpacity={0.85}>
        <LinearGradient colors={[TEAL, '#0EA5A0']} style={styles.primaryGradient}>
          <Icon name="paper-plane" size={18} color="#062a28" />
          <Text style={styles.primaryText}>Share message</Text>
        </LinearGradient>
      </TouchableOpacity>

      {!!draft?.imageUrl && (
        <TouchableOpacity style={styles.secondaryBtn} onPress={onSendImage} activeOpacity={0.85}>
          <Icon name="image" size={16} color={TEAL} />
          <Text style={styles.secondaryText}>Share image</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.ghostBtn} onPress={runCompose} activeOpacity={0.8}>
        <Text style={styles.ghostText}>Tweak / regenerate</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderError = () => {
    const info = FRIENDLY_ERROR[errorCode] || FRIENDLY_ERROR.error;
    return (
      <View style={styles.center}>
        <Text style={styles.errTitle}>{info.title}</Text>
        <Text style={styles.errBody}>{errorDetail || info.body}</Text>
        {errorCode === 'subscription_required' ? (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              onClose?.();
              navigation?.navigate?.('Plans');
            }}
            activeOpacity={0.85}
          >
            <LinearGradient colors={[TEAL, '#0EA5A0']} style={styles.primaryGradient}>
              <Text style={styles.primaryText}>{info.cta || 'Upgrade'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.secondaryBtn} onPress={reset} activeOpacity={0.85}>
            <Text style={styles.secondaryText}>Try again</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => close('discarded')}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <LinearGradient colors={['#141418', '#1C1C22']} style={styles.sheetInner}>
            <View style={styles.header}>
              <Text style={styles.title}>Blyp it</Text>
              <TouchableOpacity onPress={() => close('discarded')} style={styles.closeBtn}>
                <Icon name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            {phase === 'input' && renderInput()}
            {phase === 'composing' && renderComposing()}
            {phase === 'preview' && renderPreview()}
            {phase === 'error' && renderError()}
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  sheetInner: { padding: 20, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  closeBtn: { padding: 4 },
  lead: { color: '#A1A1AA', fontSize: 14, marginBottom: 12 },
  input: {
    minHeight: 88,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    color: '#fff',
    fontSize: 16,
    padding: 14,
    textAlignVertical: 'top',
  },
  primaryBtn: { marginTop: 16, borderRadius: 16, overflow: 'hidden' },
  primaryGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
  },
  primaryText: { color: '#062a28', fontSize: 17, fontWeight: '800' },
  secondaryBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: TEAL,
  },
  secondaryText: { color: TEAL, fontSize: 15, fontWeight: '700' },
  ghostBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  ghostText: { color: '#A1A1AA', fontSize: 14, fontWeight: '600' },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28 },
  composingText: { color: '#A1A1AA', marginTop: 14, fontSize: 15 },
  recipient: { color: TEAL, fontSize: 14, fontWeight: '700', marginBottom: 10 },
  image: { width: '100%', height: 200, borderRadius: 16, marginBottom: 16, backgroundColor: 'rgba(255,255,255,0.05)' },
  sectionLabel: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 10 },
  option: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginBottom: 10,
  },
  optionSelected: { borderColor: TEAL, backgroundColor: 'rgba(255, 45, 85,0.08)' },
  optionText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  errTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  errBody: { color: '#A1A1AA', fontSize: 14, textAlign: 'center', marginBottom: 18, lineHeight: 20 },
});

export default BlypItModal;
