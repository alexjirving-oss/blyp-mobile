// PushService — device-side half of the notification spine.
//
// The backend (Cloud Functions) already runs the dispatcher + FCM sender and reads
// tokens from users/{uid}/devices/{deviceId}. This service is the missing client
// half: ask permission, register the device's NATIVE FCM token (which the backend's
// admin.messaging() sender speaks), keep it fresh, route taps, and clean up on logout.
//
// Everything is defensively guarded: if expo-notifications isn't present (e.g. a
// build without the module) or permission is denied, every function no-ops quietly
// rather than throwing. Push is an enhancement; it must never break the app.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = 'blyp_push_device_id';
// New channel id so existing installs pick up the custom Blyp jingle
// (Android ignores sound changes on an already-created channel).
export const DEFAULT_CHANNEL_ID = 'blyp';
export const CALL_CHANNEL_ID = 'blyp_calls';
export const DEFAULT_SOUND = 'blyp_notify.wav';

// Lazy require so a build/environment without the native module degrades gracefully.
function getNotifications() {
  try {
    // eslint-disable-next-line global-require
    return require('expo-notifications');
  } catch {
    return null;
  }
}

function genId() {
  try {
    // react-native-uuid is already a dependency.
    // eslint-disable-next-line global-require
    const uuid = require('react-native-uuid');
    return String(uuid.default ? uuid.default.v4() : uuid.v4());
  } catch {
    return `dev_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  }
}

async function getStableDeviceId() {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = genId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return genId();
  }
}

function devicesDoc(uid, deviceId) {
  // eslint-disable-next-line global-require
  const { db } = require('../config/firebase');
  return db.collection('users').doc(uid).collection('devices').doc(deviceId);
}

let foregroundHandlerSet = false;

/** Make foreground notifications actually show (SDK 54 surface). */
export function configureForegroundPresentation() {
  const Notifications = getNotifications();
  if (!Notifications || foregroundHandlerSet) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const type = String(notification?.request?.content?.data?.type || '');
        const isCall = type === 'incoming_call' || type === 'call';
        return {
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          // Incoming calls must interrupt even when DND-adjacent / focused.
          priority: isCall
            ? Notifications.AndroidNotificationPriority?.MAX
            : Notifications.AndroidNotificationPriority?.HIGH,
        };
      },
    });
    foregroundHandlerSet = true;
  } catch {
    // ignore
  }
}

/** Android requires an explicit channel; FCM sender uses channelId 'blyp' / 'blyp_calls'. */
export async function ensureAndroidChannel() {
  const Notifications = getNotifications();
  if (!Notifications || Platform.OS !== 'android') return;
  try {
    const Importance = Notifications.AndroidImportance || {};
    await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
      name: 'Blyp',
      importance: Importance.HIGH ?? 4,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00D2BE',
      sound: DEFAULT_SOUND,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync(CALL_CHANNEL_ID, {
      name: 'Incoming calls',
      importance: Importance.MAX ?? 5,
      vibrationPattern: [0, 500, 200, 500, 200, 500],
      lightColor: '#00D2BE',
      sound: DEFAULT_SOUND,
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage?.NOTIFICATION_RINGTONE,
        contentType: Notifications.AndroidAudioContentType?.SONIFICATION,
      },
    });
  } catch {
    // ignore
  }
}

/**
 * Request permission + register this device's native push token under the user.
 * Returns the token string on success, or null (never throws).
 */
export async function registerForPush(uid) {
  const Notifications = getNotifications();
  if (!Notifications || !uid) return null;

  try {
    configureForegroundPresentation();
    await ensureAndroidChannel();

    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted || settings?.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL;
    if (!granted && settings.canAskAgain !== false) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted || req?.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL;
    }
    if (!granted) {
      console.warn('[push] permission not granted');
      return null;
    }

    // Native device token (FCM on Android / APNs on iOS) — matches admin.messaging().
    const tokenResult = await Notifications.getDevicePushTokenAsync();
    const token = String(tokenResult?.data || '').trim();
    if (!token) return null;

    const deviceId = await getStableDeviceId();
    let appVersion = '';
    try {
      // eslint-disable-next-line global-require
      const Application = require('expo-application');
      appVersion = String(Application?.nativeApplicationVersion || '');
    } catch {
      // ignore
    }

    await devicesDoc(uid, deviceId).set(
      {
        pushToken: token,
        tokenType: tokenResult?.type || Platform.OS,
        platform: Platform.OS,
        appVersion,
        disabled: false,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    console.warn('[push] device registered'); // release-visible breadcrumb
    return token;
  } catch (e) {
    console.warn('[push] registration failed', e?.message || String(e));
    return null;
  }
}

/** Disable this device's token on logout so we stop pushing to it. */
export async function unregisterPush(uid) {
  if (!uid) return;
  try {
    const deviceId = await getStableDeviceId();
    await devicesDoc(uid, deviceId).set({ disabled: true, updatedAt: Date.now() }, { merge: true });
  } catch {
    // ignore
  }
}

/**
 * Wire tap-routing. `onRoute(data)` receives the FCM data payload (e.g.
 * { type:'live', streamId } or { type:'streak' }). Handles cold-start taps too.
 * Returns an unsubscribe function.
 */
export function attachNotificationRouting(onRoute) {
  const Notifications = getNotifications();
  if (!Notifications || typeof onRoute !== 'function') return () => {};

  let sub = null;
  try {
    sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data || {};
      try {
        onRoute(data);
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }

  // Cold start: the app may have been launched by tapping a notification.
  try {
    Notifications.getLastNotificationResponseAsync?.().then((response) => {
      const data = response?.notification?.request?.content?.data;
      if (data) {
        try {
          onRoute(data);
        } catch {
          // ignore
        }
      }
    });
  } catch {
    // ignore
  }

  return () => {
    try {
      sub?.remove?.();
    } catch {
      // ignore
    }
  };
}

export default {
  registerForPush,
  unregisterPush,
  attachNotificationRouting,
  configureForegroundPresentation,
  ensureAndroidChannel,
  DEFAULT_CHANNEL_ID,
  DEFAULT_SOUND,
};
