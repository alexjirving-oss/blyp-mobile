import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import Icon from './Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont } from '../utils/scaleUtils';
import {
  setTopicNotificationsEnabled,
  subscribeTopicNotifications,
} from '../services/topicNotificationPreferencesService';
import { registerForPush } from '../services/PushService';

const TopicNotificationToggle = ({
  uid,
  topicId,
  label = 'Topic',
  description = 'Key updates from verified topic feeds',
  accent = COLORS.primary,
  style,
}) => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeTopicNotifications(uid, topicId, (next) => {
      setEnabled(next === true);
      setLoading(false);
    });
    return unsubscribe;
  }, [uid, topicId]);

  const onToggle = async (next) => {
    if (saving || loading) return;
    if (!uid || uid === 'anon') {
      Alert.alert('Sign in needed', 'Sign in to save topic notification preferences.');
      return;
    }

    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    try {
      await setTopicNotificationsEnabled(uid, topicId, next);
      if (next) {
        // Topic alerts still appear in-app if OS permission is declined.
        await registerForPush(uid);
      }
    } catch (error) {
      setEnabled(previous);
      Alert.alert(
        'Couldn’t update notifications',
        error?.message || 'Please check your connection and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View
      style={[styles.root, { borderColor: `${accent}55` }, style]}
      accessibilityLabel={`${label} notification preference`}
    >
      <View style={[styles.iconWrap, { backgroundColor: `${accent}22` }]}>
        <Icon
          name={enabled ? 'notifications' : 'notifications-outline'}
          size={19}
          color={accent}
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{label} notifications</Text>
        <Text style={styles.description}>
          {enabled ? `On · ${description}` : `Off · ${description}`}
        </Text>
      </View>
      <Switch
        value={enabled}
        disabled={loading || saving}
        onValueChange={onToggle}
        trackColor={{ false: '#3F3F46', true: accent }}
        thumbColor="#F5F5F7"
        accessibilityRole="switch"
        accessibilityLabel={`${label} notifications`}
        accessibilityHint="Turns key event notifications for this topic on or off"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(10,10,12,0.82)',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, paddingRight: 4 },
  title: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    fontWeight: '800',
  },
  description: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(10),
    lineHeight: responsiveFont(14),
    marginTop: 2,
  },
});

export default TopicNotificationToggle;
