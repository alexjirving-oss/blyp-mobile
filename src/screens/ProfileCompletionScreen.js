import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BlypLogo from '../components/BlypLogo';
import { claimUsername, validateUsername } from '../services/usernameProfileService';
import { COLORS } from '../styles/theme';

export default function ProfileCompletionScreen({
  uid,
  initialUsername = '',
  email = '',
  photoURL = '',
  canSkip = false,
  onComplete,
  onSkip,
}) {
  const [username, setUsername] = useState(initialUsername);
  const [saving, setSaving] = useState(false);
  const validation = useMemo(() => validateUsername(username, uid), [uid, username]);

  const save = async () => {
    if (!validation.ok) {
      Alert.alert('Check your username', validation.message);
      return;
    }
    setSaving(true);
    try {
      const result = await claimUsername({
        uid,
        username: validation.username,
        email,
        photoURL,
      });
      onComplete?.(result);
    } catch (error) {
      Alert.alert(
        error?.code === 'USERNAME_TAKEN' ? 'Username taken' : 'Could not save username',
        error?.message || 'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.page}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}
      >
        <View style={styles.logo}>
          <BlypLogo useGradientBackground />
        </View>
        <View style={styles.card}>
          <Text style={styles.title}>Choose your Blyp username</Text>
          <Text style={styles.body}>
            This is your public @handle in profiles, live rooms, comments, and notifications.
          </Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="username"
            placeholderTextColor="#71717A"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            editable={!saving}
            style={styles.input}
          />
          <Text style={[styles.hint, username && !validation.ok ? styles.error : null]}>
            {username && !validation.ok
              ? validation.message
              : '3–20 letters, numbers, underscores, or dots. Usernames are unique.'}
          </Text>
          <TouchableOpacity
            onPress={save}
            disabled={saving || !validation.ok}
            activeOpacity={0.85}
            style={styles.buttonWrap}
          >
            <LinearGradient
              colors={[COLORS.primary, '#00A89E']}
              style={[styles.button, (saving || !validation.ok) && styles.disabled]}
            >
              {saving
                ? <ActivityIndicator color="#0A0A0C" />
                : <Text style={styles.buttonText}>Complete profile</Text>}
            </LinearGradient>
          </TouchableOpacity>
          {canSkip && (
            <TouchableOpacity onPress={onSkip} disabled={saving} style={styles.skip}>
              <Text style={styles.skipText}>Not now</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.pageBackground,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    alignItems: 'center',
    marginBottom: 34,
    transform: [{ scale: 1.45 }],
  },
  card: {
    backgroundColor: '#121216',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 23,
    fontWeight: '800',
    textAlign: 'center',
  },
  body: {
    color: '#A1A1AA',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#1C1C22',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    borderWidth: 1,
    color: '#FFFFFF',
    fontSize: 17,
    marginTop: 22,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  hint: {
    color: '#71717A',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  error: {
    color: '#FCA5A5',
  },
  buttonWrap: {
    marginTop: 20,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    minHeight: 52,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#0A0A0C',
    fontSize: 16,
    fontWeight: '800',
  },
  skip: {
    alignItems: 'center',
    marginTop: 16,
    padding: 8,
  },
  skipText: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '600',
  },
});
