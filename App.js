// Boot timing marker: captured at the very first line of JS module evaluation so
// we can measure time-to-interactive (logged when the app reports ready).
const __BLYP_BOOT_T0 = Date.now();
try { if (typeof global !== 'undefined') global.__BLYP_BOOT_T0 = __BLYP_BOOT_T0; } catch { }

// Ensure TypeScript helper library is available immediately for any deps that load early
// Place before ANY other imports
import 'tslib';
import * as tslibRuntime from 'tslib';
// Fallback to explicit CJS build if needed and expose globally for older helper patterns
try {
  if (!tslibRuntime || !tslibRuntime.__extends) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tslibCjs = require('tslib/tslib.js');
    if (typeof globalThis !== 'undefined') {
      globalThis.tslib = globalThis.tslib || tslibCjs;
    }
  } else if (typeof globalThis !== 'undefined') {
    globalThis.tslib = globalThis.tslib || tslibRuntime;
  }
} catch (e) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tslibCjs = require('tslib/tslib.js');
    if (typeof globalThis !== 'undefined') {
      globalThis.tslib = globalThis.tslib || tslibCjs;
    }
  } catch { }
}
// Polyfill for crypto.getRandomValues() and atob
import 'react-native-get-random-values';
import '@expo/metro-runtime';
import { decode } from 'base-64';

if (typeof global.atob === 'undefined') {
  global.atob = decode;
}

// Debug marker to confirm prelude executed before App
// eslint-disable-next-line no-console
console.log('[BLYP][APP] PRELUDE?', global.BLYP_PRELUDE);

// ============================================================================
// CRITICAL: Amplify must be configured BEFORE any component mounts
// that uses IVS live streaming (which requires Cognito JWT).
// This import runs side-effects synchronously at module load time.
// ============================================================================
import './src/config/amplify';

// LiveKit WebRTC globals (audio calls). Safe no-op if native module not yet linked.
try {
  // eslint-disable-next-line global-require
  const { registerGlobals } = require('@livekit/react-native');
  if (typeof registerGlobals === 'function') registerGlobals();
} catch {
  // Native LiveKit not in this binary yet — CallScreen will surface a clear error.
}

// Note: Other startup side-effects (pre-auth cleanup, Sentry, flags)
// are deferred until after runtime is ready to avoid early WebSocket/runtime issues.

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { NavigationContainer, createNavigationContainerRef, DefaultTheme, CommonActions } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, ActivityIndicator, LogBox, Platform, TouchableOpacity, Linking, StatusBar as RNStatusBar } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { enableScreens } from 'react-native-screens';
import * as SplashScreen from 'expo-splash-screen';
import TestRender from './src/components/TestRender';
import { CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';

// Enable native screens optimization
enableScreens();

// Note: LogBox.ignoreLogs must run post-mount to avoid touching RN internals too early

const BLYP_CHROME_BLACK = '#0A0A0C';

function useAndroidChromeBlack() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    try {
      RNStatusBar.setBarStyle('light-content');
      RNStatusBar.setBackgroundColor(BLYP_CHROME_BLACK);
      RNStatusBar.setTranslucent(true);
    } catch { }
    NavigationBar.setButtonStyleAsync('light').catch(() => {});
  }, []);
}

function BLYP_nativeLog(message, level = 1) {
  try {
    const msg = typeof message === 'string' ? message : JSON.stringify(message);
    if (level >= 2) {
      // eslint-disable-next-line no-console
      console.warn(msg);
    } else {
      // eslint-disable-next-line no-console
      console.log(msg);
    }
  } catch { }
}

import Toast from 'react-native-toast-message';
import BlypLogo, { BLYP_LOGO_GRADIENT_COLORS } from './src/components/BlypLogo';
import { PerformanceProvider } from './src/performance/PerformanceStore';
import { COLORS } from './src/styles/theme';
import { ThemeProvider } from './src/styles/ThemeProvider';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { setupImmersiveNavBar } from './src/utils/systemNavBar';
// Firebase native/runtime flags
import { auth as firebaseAuth, firebaseConfig, firebaseNative, db } from './src/config/firebase';
// Lazy require native modules to avoid bundler issues when absent
let crashlytics = null; let perf = null; let messaging = null;
if (firebaseNative) {
  try { crashlytics = require('@react-native-firebase/crashlytics').default(); } catch { }
  try { perf = require('@react-native-firebase/perf').default(); } catch { }
  try { messaging = require('@react-native-firebase/messaging').default(); } catch { }
}

// Import screens
import HomeScreen from './src/screens/HomeScreen';
import ArtilleryGameScreen from './src/games/artillery/ArtilleryGameScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatConversationScreen from './src/screens/ChatConversationScreen';
import MessengerScreen from './src/screens/MessengerScreen';
import CallScreen from './src/screens/CallScreen';
// Legacy Profile is kept for reference; new v3 replaces it
// import ProfileScreen from './src/screens/ProfileScreen';
import ProfileScreenV3 from './src/screens/ProfileScreen.v3';
import { WalletStub, SettingsStub, MyVideosStub, PastLivesStub, LiveUnavailableStub } from './src/screens/StubScreens';
import EditProfileScreen from './src/screens/EditProfileScreen';
import PrivacySettingsScreen from './src/screens/PrivacySettingsScreen';
import NotificationSettingsScreen from './src/screens/NotificationSettingsScreen';
import HelpSupportScreen from './src/screens/HelpSupportScreen';
import AuthScreen from './src/screens/AuthScreen';
const CameraScreen = React.lazy(() => import('./src/screens/CameraScreen'));
// Lazy screens
const ReviewScreen = React.lazy(() => import('./src/screens/ReviewScreen'));
import VoiceMemoScreen from './src/screens/VoiceMemoScreen';
import PostPreviewScreen from './src/screens/PostPreviewScreen';
const MediaViewerScreen = React.lazy(() => import('./src/screens/MediaViewerScreen'));
import LiveStreamScreen from './src/screens/LiveStreamScreen';
import LiveErrorBoundary from './src/components/LiveErrorBoundary';
import ScreenErrorBoundary from './src/components/ScreenErrorBoundary';
import LiveSummaryScreen from './src/screens/LiveSummaryScreen';
import SearchScreen from './src/screens/SearchScreen';
import SearchResultsScreen from './src/screens/SearchResultsScreen';
import BlypScreen from './src/screens/BlypScreen';
import TransparencyScreen from './src/screens/TransparencyScreen';
import PlansScreen from './src/screens/PlansScreen';
import HowBlypWorksScreen from './src/screens/HowBlypWorksScreen';
import ImportContentScreen from './src/screens/ImportContentScreen';
import GlobalImportProgress from './src/components/GlobalImportProgress';
import HubScreen from './src/screens/HubScreen';
import BlypResultsScreen from './src/screens/BlypResultsScreen';
import PagesEditorScreen from './src/screens/PagesEditorScreen';
import SavedScreen from './src/screens/SavedScreen';
import ActivityScreen from './src/screens/ActivityScreen';
import YourBlypScreen from './src/screens/YourBlypScreen';
import CreateBattleScreen from './src/screens/CreateBattleScreen';
import BattleDetailScreen from './src/screens/BattleDetailScreen';
import BattleLeaderboardScreen from './src/screens/BattleLeaderboardScreen';
import BattleDiaryScreen from './src/screens/BattleDiaryScreen';
import RoomsScreen from './src/screens/RoomsScreen';
import RoomScreen from './src/screens/RoomScreen';
import WebBrowserScreen from './src/screens/WebBrowserScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { isOnboarded, subscribePreferences } from './src/services/userPreferencesService';
import CommentsScreen from './src/screens/CommentsScreen';
import UserProfileScreen from './src/screens/UserProfileScreen';
import FollowersScreen from './src/screens/FollowersScreen';
import FindPeopleScreen from './src/screens/FindPeopleScreen';
import TeamDetailScreen from './src/screens/TeamDetailScreen';
import MyTeamScreen from './src/screens/MyTeamScreen';
// Gaming screens (lazy)
const GamesScreen = React.lazy(() => import('./src/screens/GamesScreen'));
const GameRoomScreen = React.lazy(() => import('./src/screens/GameRoomScreen'));
const ModerationQueueScreen = React.lazy(() => import('./src/screens/ModerationQueueScreen'));
// Bridge test screen (diagnostic - lazy)
const BridgeTestScreen = React.lazy(() => import('./src/screens/BridgeTestScreen').then(m => ({ default: m.BridgeTestScreen })));
// Chat rooms screens
import ChatRoomsScreen from './src/screens/ChatRoomsScreen';
import ChatRoomScreen from './src/screens/ChatRoomScreen';
// Blypcoin screens
import CoinStoreScreen from './src/screens/CoinStoreScreen';
// Matchday Live (premium football companion)
const MatchdayRoomScreen = React.lazy(() => import('./src/screens/MatchdayRoomScreen'));

// Import components and utilities
import TabBarIcon from './src/components/TabBarIcon';
import CreatePostButton from './src/components/CreatePostButton';
import { useAuth, userPool, clearCognitoSessions, refreshAuthNow, hardLogout } from './src/hooks/useCommon';
import { exitGuestMode, useGuestMode } from './src/services/guestSessionService';
import { emitTabReset } from './src/utils/tabResetBus';
import { useUnreadCount } from './src/hooks/useUnreadCount';
import { scalingConfig } from './src/utils/scaleUtils';
const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

const navigationRef = createNavigationContainerRef();

// Module-level flag: when true the sticky-auth window is bypassed so
// logout transitions to AuthScreen on the very next render cycle.
let __hardLogoutRequested = false;

async function hardLogoutAndResetToAuth(reason) {
  try { console.warn('[BLYP][AUTH] hardLogoutAndResetToAuth', { reason: String(reason || '') }); } catch { }
  // 0. Signal: skip the sticky-auth window so the UI flips immediately
  __hardLogoutRequested = true;
  // 1. Drop any guest session so we don't bounce back into the app as a guest.
  try { await exitGuestMode(); } catch { }
  // 2. Latch hard-logout in the auth engine. This clears the optimistic /
  //    last-known / last-stable windows that would otherwise keep the user
  //    "signed in" for up to 120s, and signs out Cognito + Firebase.
  try { await hardLogout(); } catch { }
  // 3. Belt-and-braces: null out auth state (triggers render → AuthScreen)
  try { refreshAuthNow?.(null); } catch { }
  // 4. Hard reset navigation stack to initial route (cleans up deep screens)
  try {
    if (navigationRef?.isReady?.()) {
      navigationRef.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        })
      );
    }
  } catch { }
}

function parseQueryString(raw) {
  const out = {};
  try {
    const s = String(raw || '').replace(/^\?/, '');
    if (!s) return out;
    for (const part of s.split('&')) {
      if (!part) continue;
      const [kRaw, vRaw = ''] = part.split('=');
      if (!kRaw) continue;
      const k = decodeURIComponent(kRaw);
      const v = decodeURIComponent(vRaw);
      out[k] = v;
    }
  } catch { }
  return out;
}

function parseE2EUrl(url) {
  try {
    const raw = String(url || '').trim();
    if (!raw) return null;
    // Accept both blyp://e2e-login?... and blyp://e2e-login/...?
    const m = raw.match(/^([A-Za-z0-9+.-]+):\/\/([^?/#]+)(?:\/[^?]*)?(?:\?([^#]*))?/);
    if (!m) return null;
    const scheme = (m[1] || '').toLowerCase();
    const host = (m[2] || '').toLowerCase();
    const query = parseQueryString(m[3] || '');
    return { scheme, host, query, raw };
  } catch {
    return null;
  }
}

function maskEmail(raw) {
  try {
    const trimmed = String(raw || '').trim();
    const [u, d] = trimmed.split('@');
    if (!d) return u ? u.slice(0, 2) + '***' : '***';
    return (u ? u.slice(0, 2) : '') + '***@' + d;
  } catch {
    return '***';
  }
}

let __lastE2ENonce = null;

// Tracks the last tab-press time per tab so we can detect a double tap and
// reset that tab to its first sub-page (Home→For You, Chat/Games→Live,
// Inbox→Chats, Profile→My Profile). The screens subscribe via useTabReset.
const __lastTabTap = {};
const DOUBLE_TAP_MS = 450;

function makeDoubleTapResetListener(tabName) {
  return ({ navigation }) => ({
    tabPress: () => {
      const now = Date.now();
      const last = __lastTabTap[tabName] || 0;
      __lastTabTap[tabName] = now;
      // Reset only when the second tap lands quickly. We allow it whether or not
      // the tab was already focused (a quick double-tap from elsewhere also
      // lands you on the first sub-page).
      if (now - last < DOUBLE_TAP_MS) {
        emitTabReset(tabName);
      }
    },
  });
}

function MainTabs() {
  const unreadCount = useUnreadCount();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 4);
  const tabBarHeight = 68 + Math.max(insets.bottom - 4, 0);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // Only mount a tab screen the first time it's focused (v7 default, made
        // explicit), and freeze inactive tabs so their renders/effects pause
        // while blurred — keeps Home smooth and avoids background work in Chat,
        // Messenger and Profile until the user actually visits them.
        lazy: true,
        freezeOnBlur: true,
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: tabBarHeight,
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.08)',
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          paddingTop: 6,
          paddingBottom: bottomPad,
          backgroundColor: 'rgba(10,10,12,0.98)',
          shadowColor: '#000000',
          shadowOpacity: 0.34,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -2 },
          elevation: 12,
        },
        tabBarItemStyle: {
          paddingTop: 0,
          paddingBottom: 2,
        },
        tabBarIconStyle: {
          marginTop: 0,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.2,
          marginTop: 1,
        },
        tabBarLabelPosition: 'below-icon',
        tabBarActiveTintColor: BLYP_LOGO_GRADIENT_COLORS[1],
        tabBarInactiveTintColor: 'rgba(148,163,184,0.88)',
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        listeners={makeDoubleTapResetListener('Home')}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="home" color={color} size={size} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatListScreen}
        listeners={makeDoubleTapResetListener('Chat')}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="game-controller" color={color} size={size} focused={focused} />
          ),
          tabBarLabel: 'Chat/Games',
        }}
      />
      <Tab.Screen
        name="CreatePost"
        component={View}
        options={{
          tabBarButton: (props) => <CreatePostButton {...props} />,
          tabBarLabel: '',
        }}
      />
      <Tab.Screen
        name="Messenger"
        component={MessengerScreen}
        listeners={makeDoubleTapResetListener('Messenger')}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="call" color={color} size={size} focused={focused} badge={unreadCount > 0 ? unreadCount : null} />
          ),
          tabBarLabel: 'Phone',
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreenV3}
        listeners={makeDoubleTapResetListener('Profile')}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="person" color={color} size={size} focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function AppStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        // Freeze screens that are pushed behind the current one so their renders
        // and effects pause until the user navigates back to them.
        freezeOnBlur: true,
        cardStyleInterpolator: ({ current, layouts }) => {
          return {
            cardStyle: {
              transform: [
                {
                  translateX: current.progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [layouts.screen.width, 0],
                  }),
                },
              ],
            },
          };
        },
      }}
    >
      <Stack.Screen name="MainTabs">
        {(navProps) => (
          <ScreenErrorBoundary label="MainTabs">
            <MainTabs {...navProps} />
          </ScreenErrorBoundary>
        )}
      </Stack.Screen>
      <Stack.Screen name="Blyp" component={BlypScreen} />
      <Stack.Screen name="Transparency" component={TransparencyScreen} />
      <Stack.Screen name="Plans" component={PlansScreen} />
      <Stack.Screen name="HowBlypWorks" component={HowBlypWorksScreen} />
      <Stack.Screen name="ImportContent" component={ImportContentScreen} />
      <Stack.Screen name="Hub" component={HubScreen} />
      <Stack.Screen name="BlypResults" component={BlypResultsScreen} />
      <Stack.Screen name="PagesEditor" component={PagesEditorScreen} />
      <Stack.Screen name="Saved" component={SavedScreen} />
      <Stack.Screen name="Activity" component={ActivityScreen} />
      <Stack.Screen name="YourBlyp" component={YourBlypScreen} />
      <Stack.Screen name="CreateBattle" component={CreateBattleScreen} />
      <Stack.Screen name="BattleDetail" component={BattleDetailScreen} />
      <Stack.Screen name="BattleLeaderboard" component={BattleLeaderboardScreen} />
      <Stack.Screen name="BattleDiary" component={BattleDiaryScreen} />
      <Stack.Screen name="Rooms" component={RoomsScreen} />
      <Stack.Screen name="Room" component={RoomScreen} />
      <Stack.Screen name="WebBrowser" component={WebBrowserScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="Comments" component={CommentsScreen} />
      <Stack.Screen name="UserProfile">
        {(navProps) => (
          <ScreenErrorBoundary label="UserProfile" onReset={() => { try { navProps.navigation.goBack(); } catch {} }}>
            <UserProfileScreen {...navProps} />
          </ScreenErrorBoundary>
        )}
      </Stack.Screen>
      <Stack.Screen name="Followers" component={FollowersScreen} />
      <Stack.Screen name="ChatConversation">
        {(navProps) => (
          <ScreenErrorBoundary label="ChatConversation" onReset={() => { try { navProps.navigation.goBack(); } catch {} }}>
            <ChatConversationScreen {...navProps} />
          </ScreenErrorBoundary>
        )}
      </Stack.Screen>
      <Stack.Screen
        name="Call"
        options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }}
      >
        {(navProps) => (
          <ScreenErrorBoundary label="Call" onReset={() => { try { navProps.navigation.goBack(); } catch {} }}>
            <CallScreen {...navProps} />
          </ScreenErrorBoundary>
        )}
      </Stack.Screen>
      <Stack.Screen name="FindPeople" component={FindPeopleScreen} />
      <Stack.Screen name="TeamDetail" component={TeamDetailScreen} />
      <Stack.Screen name="MyTeam" component={MyTeamScreen} />
      <Stack.Screen name="ArtilleryGame" component={ArtilleryGameScreen} />
      <Stack.Screen name="Camera" children={() => (
        <Suspense fallback={null}>
          <CameraScreen />
        </Suspense>
      )} />
      <Stack.Screen name="Review" children={() => (
        <Suspense fallback={null}>
          <ReviewScreen />
        </Suspense>
      )} />
      <Stack.Screen name="MediaViewer" children={(props) => (
        <ScreenErrorBoundary label="MediaViewer" onReset={() => { try { props.navigation.goBack(); } catch {} }}>
          <Suspense fallback={null}>
            <MediaViewerScreen {...props} />
          </Suspense>
        </ScreenErrorBoundary>
      )} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="PrivacySettings" component={PrivacySettingsScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="HelpSupport" component={HelpSupportScreen} />
      <Stack.Screen name="WalletStub" component={WalletStub} />
      <Stack.Screen name="SettingsStub" component={SettingsStub} />
      <Stack.Screen name="MyVideosStub" component={MyVideosStub} />
      <Stack.Screen name="PastLivesStub" component={PastLivesStub} />
      <Stack.Screen name="LiveUnavailableStub" component={LiveUnavailableStub} />
      <Stack.Screen name="VoiceMemo" component={VoiceMemoScreen} />
      <Stack.Screen name="LiveStreamScreen">
        {(navProps) => (
          <LiveErrorBoundary onReset={() => { try { navProps.navigation.goBack(); } catch {} }}>
            <Suspense fallback={null}>
              <LiveStreamScreen {...navProps} />
            </Suspense>
          </LiveErrorBoundary>
        )}
      </Stack.Screen>
      <Stack.Screen
        name="LiveSummary"
        component={LiveSummaryScreen}
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen name="PostPreview" component={PostPreviewScreen} />
      <Stack.Screen name="SearchResults" component={SearchResultsScreen} />
      <Stack.Screen name="Games" children={() => (
        <Suspense fallback={null}>
          <GamesScreen />
        </Suspense>
      )} />
      <Stack.Screen name="GameRoom" children={() => (
        <Suspense fallback={null}>
          <GameRoomScreen />
        </Suspense>
      )} />
      <Stack.Screen name="ChatRooms" component={ChatRoomsScreen} />
      <Stack.Screen name="ChatRoom" component={ChatRoomScreen} />
      <Stack.Screen name="CoinStore" component={CoinStoreScreen} />
      <Stack.Screen name="MatchdayRoom" children={(navProps) => (
        <Suspense fallback={null}>
          <MatchdayRoomScreen {...navProps} />
        </Suspense>
      )} />
      <Stack.Screen name="ModerationQueue" children={() => (
        <Suspense fallback={null}>
          <ModerationQueueScreen />
        </Suspense>
      )} />
      <Stack.Screen name="BridgeTest" children={() => (
        <Suspense fallback={null}>
          <BridgeTestScreen />
        </Suspense>
      )} options={{ title: '🔬 Bridge Test' }} />
    </Stack.Navigator>
  );
}

function AppInner() {
  useAndroidChromeBlack();
  const [appError, setAppError] = useState(null);
  const { user, uid, loading, error: authError } = useAuth();
  const lastAuthErrorHandledRef = useRef(null);
  // Keep the Android system navigation bar in sticky-immersive mode (hidden,
  // swipe to reveal) so it doesn't sit on screen permanently on 3-button devices.
  useEffect(() => {
    const cleanup = setupImmersiveNavBar();
    return cleanup;
  }, []);
  // Prevent brief post-login bounce by keeping UI authenticated for a short window
  const authStickyUntilRef = useRef(0);
  const [hadUser, setHadUser] = useState(false);
  useEffect(() => {
    if (user) {
      setHadUser(true);
      // Sticky window: briefly keep UI authenticated during auth polling.
      // Keep this short; otherwise the UI can look logged-in while Cognito is actually expired.
      authStickyUntilRef.current = Date.now() + 15000; // 15s
    } else if (!user && hadUser) {
      // User actually logged out - clear sticky window immediately
      authStickyUntilRef.current = 0;
      setHadUser(false);
    }
  }, [user, hadUser]);
  // Bypass the sticky window when hardLogoutAndResetToAuth was called so the
  // UI drops to AuthScreen on the very next render (no 15s delay).
  if (__hardLogoutRequested && !user) {
    authStickyUntilRef.current = 0;
    __hardLogoutRequested = false;
  }
  const effectiveUser = user || (hadUser && Date.now() < authStickyUntilRef.current ? {} : null);
  // Guest ("browse only") session: no real identity, but allowed past the gate.
  const isGuest = useGuestMode();
  // Development-only auth bypass (does NOT grant real identity). Keeps Security priority by requiring explicit env flag.
  const devForceNoAuth = (process.env?.EXPO_PUBLIC_DEV_FORCE_NO_AUTH === '1');
  if (devForceNoAuth && !effectiveUser) {
    // eslint-disable-next-line no-console
    console.warn('[BLYP][AUTH] DEV_FORCE_NO_AUTH active – rendering app without authenticated user');
  }

  // First-run onboarding gate. null = still checking (don't block returning users).
  const [onboarded, setOnboarded] = useState(null);
  const canShowApp = devForceNoAuth || !!effectiveUser || isGuest;
  useEffect(() => {
    let active = true;
    let unsub = () => {};
    if (!canShowApp) {
      setOnboarded(null);
      return undefined;
    }
    // Guests have no uid to personalize, so skip the interest/plan onboarding.
    if (isGuest && !effectiveUser) {
      setOnboarded(true);
      return undefined;
    }
    if (!uid) {
      setOnboarded(null);
      return undefined;
    }
    isOnboarded(uid)
      .then((v) => {
        if (active) setOnboarded(v);
      })
      .catch(() => {
        if (active) setOnboarded(true);
      });
    // Late Firestore hydrate must flip the gate so returning users aren't stuck
    // in onboarding (and a fresh 30-day trial) after a local cache miss.
    unsub = subscribePreferences(uid, (prefs) => {
      if (active && prefs?.onboarded) setOnboarded(true);
    });
    return () => {
      active = false;
      try { unsub(); } catch { /* ignore */ }
    };
  }, [canShowApp, uid, isGuest, effectiveUser]);

  // Global error handler for uncaught exceptions
  useEffect(() => {
    // Lazily grab the Sentry capture fn (preserves deferred native init).
    let sentryCapture = null;
    import('./src/monitoring/sentry')
      .then((m) => { sentryCapture = m.captureException; })
      .catch(() => { });

    const report = (error) => {
      try { sentryCapture && sentryCapture(error); } catch { }
      if (crashlytics) {
        try {
          crashlytics.log(String(error?.message || 'Unhandled error'));
          crashlytics.recordError(error);
        } catch { }
      }
    };

    const errorHandler = (error) => {
      console.error('Unhandled error:', error);
      report(error);
      setAppError(error.message || 'An unexpected error occurred');
    };

    if (Platform.OS === 'web') {
      window.addEventListener('error', errorHandler);
      return () => window.removeEventListener('error', errorHandler);
    }

    // Native: chain a JS-thread global handler so uncaught errors reach
    // Sentry/Crashlytics without overriding the dev RedBox. Only fatal errors
    // surface the blocking error screen (matching prior native behavior of none
    // for non-fatal).
    let prevHandler = null;
    const g = (typeof global !== 'undefined' && global.ErrorUtils) ? global.ErrorUtils : null;
    if (g?.setGlobalHandler) {
      prevHandler = g.getGlobalHandler?.() || null;
      g.setGlobalHandler((error, isFatal) => {
        report(error);
        if (isFatal) setAppError(error?.message || 'An unexpected error occurred');
        try { prevHandler && prevHandler(error, isFatal); } catch { }
      });
    }
    return () => {
      if (prevHandler && g?.setGlobalHandler) g.setGlobalHandler(prevHandler);
    };
  }, []);

  // Show error screen if authentication fails
  useEffect(() => {
    const msg = String(authError?.message || authError || '').trim();
    if (!msg) {
      lastAuthErrorHandledRef.current = null;
      return;
    }

    // Transient auth hysteresis signal (not a real failure). This is used to
    // reduce post-login bounce during hydration/reload races; do not surface it
    // as a blocking error screen.
    if (msg === 'AUTH_UNSTABLE_DEFERRED' || msg === 'AUTH_REHYDRATED_FROM_LASTKNOWN') {
      setAppError(null);
      return;
    }

    // Avoid repeating the same error over and over (LogBox spam / loops)
    if (lastAuthErrorHandledRef.current === msg) return;
    lastAuthErrorHandledRef.current = msg;

    // Common dev-bricker: Cognito session persisted in AsyncStorage is malformed.
    // Treat as recoverable: clear local session artifacts and fall back to AuthScreen.
    if (msg.includes('COGNITO_SESSION_CORRUPTED_RELOGIN')) {
      // eslint-disable-next-line no-console
      console.warn('[BLYP][AUTH] Cognito session corrupted; clearing local session and returning to login');
      setAppError(null);
      (async () => {
        try { await hardLogoutAndResetToAuth('COGNITO_SESSION_CORRUPTED_RELOGIN'); } catch { }
      })();
      return;
    }

    console.error('Auth error:', authError);
    setAppError(msg);
  }, [authError]);

  // Native Firebase one-time startup (Crashlytics, Perf, Messaging)
  useEffect(() => {
    if (!firebaseNative) return;
    try { crashlytics?.setCrashlyticsCollectionEnabled(true); } catch { }
    try { perf?.setPerformanceCollectionEnabled?.(true); } catch { }
    // Messaging foreground handler (basic logging placeholder)
    try {
      messaging?.onMessage(async msg => {
        console.log('📩 FCM foreground message:', msg?.data || msg);
      });
    } catch { }
  }, []);

  // ============================================================================
  // TEMP DEV PROOF LOGS (MEGACOMMAND: FIX_FIREBASE_PERMISSION_DENIED_CONVERSATIONS)
  // - Prove auth uid at runtime
  // - Prove Firebase projectId in use
  // - Prove Firebase auth currentUser uid
  // ============================================================================
  useEffect(() => {
    if (!__DEV__) return;
    try {
      const fbUid = firebaseAuth?.currentUser?.uid || null;
      // eslint-disable-next-line no-console
      console.log('[BLYP][DEV][AUTH_PROOF]', {
        cognitoUid: uid || null,
        firebaseUid: fbUid,
        firebaseProjectId: firebaseConfig?.projectId || null,
        firebaseNative: !!firebaseNative,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[BLYP][DEV][AUTH_PROOF] failed', e?.message || String(e));
    }
  }, [uid]);

  // ============================================================================
  // Push client bootstrap (notification spine — device half).
  // Registers this device's native push token under users/{uid}/devices and wires
  // tap-routing. Fully guarded: no-ops if expo-notifications / FCM aren't present,
  // so it can never break boot. Lights up automatically once FCM is wired natively.
  // ============================================================================
  useEffect(() => {
    const fbUid = firebaseAuth?.currentUser?.uid || uid || null;
    if (!fbUid) return undefined;
    let detach = () => {};
    const routeWhenReady = (name, params, tries = 0) => {
      try {
        if (navigationRef?.isReady?.()) {
          navigationRef.navigate(name, params);
          return;
        }
      } catch { }
      if (tries < 40) setTimeout(() => routeWhenReady(name, params, tries + 1), 400);
    };
    (async () => {
      try {
        // eslint-disable-next-line global-require
        const Push = require('./src/services/PushService');
        await Push.registerForPush(fbUid);
        detach = Push.attachNotificationRouting((data) => {
          try {
            if (!data) return;
            if (data.type === 'live' && data.streamId) {
              // Join as a VIEWER. LiveStreamScreen falls back to HOST (Go Live) mode
              // unless it gets mode:'viewer' + hostUid + streamId, so pass all three
              // (the payload's host field may be hostId or hostUid).
              routeWhenReady('LiveStreamScreen', {
                mode: 'viewer',
                streamId: data.streamId,
                hostUid: data.hostUid || data.hostId,
                hostId: data.hostId || data.hostUid,
              });
            } else if (data.type === 'presence' && data.targetId) {
              routeWhenReady('UserProfile', { userId: data.targetId, username: data.targetName || '@user' });
            } else if ((data.type === 'battle_invite' || data.type === 'battle' || data.type === 'battle_scheduled' || data.type === 'battle_start') && data.battleId) {
              routeWhenReady('BattleDetail', { battleId: data.battleId });
            } else if (data.type === 'streak') {
              routeWhenReady('Home');
            } else if ((data.type === 'message' || data.type === 'conversation') && data.conversationId) {
              routeWhenReady('ChatConversation', {
                conversationId: data.conversationId,
                chatId: data.conversationId,
                otherUser: { id: data.senderId, displayName: data.senderName, username: data.senderName },
              });
            } else if ((data.type === 'incoming_call' || data.type === 'call') && data.callId) {
              try {
                // eslint-disable-next-line global-require
                const { showIncomingCallNative } = require('./src/services/incomingCallNative');
                showIncomingCallNative(data.callId, data.callerName || 'Incoming call');
              } catch {
                // ignore
              }
              routeWhenReady('Call', {
                callId: data.callId,
                role: 'callee',
                peerName: data.callerName || 'Incoming call',
                callerId: data.callerId,
              });
            } else if (data.type === 'team') {
              // Team join request/decision/group message → open My Team.
              routeWhenReady('MyTeam');
            }
          } catch { }
        });
      } catch { }
    })();
    return () => { try { detach(); } catch { } };
  }, [uid]);

  // Foreground incoming-call watcher (Firestore ringing docs where we are callee).
  useEffect(() => {
    const fbUid = firebaseAuth?.currentUser?.uid || uid || null;
    if (!fbUid) return undefined;
    let unsub = () => {};
    // Dedup: Firestore snapshots re-fire often; re-navigating / re-ringing
    // every tick made CallScreen feel laggy and buggy.
    const handledCallIds = new Set();
    const openCall = (params, tries = 0) => {
      try {
        if (navigationRef?.isReady?.()) {
          const state = navigationRef.getRootState?.();
          const routes = state?.routes || [];
          const top = routes[routes.length - 1];
          if (top?.name === 'Call' && top?.params?.callId === params.callId) return;
          const already = routes.some(
            (r) => r?.name === 'Call' && r?.params?.callId === params.callId,
          );
          if (already) return;
          navigationRef.navigate('Call', params);
          return;
        }
      } catch { }
      if (tries < 40) setTimeout(() => openCall(params, tries + 1), 400);
    };
    try {
      // eslint-disable-next-line global-require
      const callService = require('./src/services/callService');
      unsub = callService.subscribeToIncomingCalls(fbUid, (incoming) => {
        const first = Array.isArray(incoming) && incoming.length ? incoming[0] : null;
        if (!first?.id) return;
        if (handledCallIds.has(first.id)) return;
        handledCallIds.add(first.id);
        try {
          // eslint-disable-next-line global-require
          const { showIncomingCallNative } = require('./src/services/incomingCallNative');
          showIncomingCallNative(first.id, first.callerName || 'Incoming call');
        } catch {
          // ignore
        }
        openCall({
          callId: first.id,
          role: 'callee',
          peerName: first.callerName || 'Incoming call',
          peerAvatar: null,
          callerId: first.callerId,
        });
      });
    } catch {
      // ignore
    }
    return () => { try { unsub(); } catch { } };
  }, [uid]);

  // ============================================================================
  // Presence heartbeat (powers "notify me when <person> is next on the app").
  // Stamps users/{uid}.presence on foreground/background. Fully guarded.
  // ============================================================================
  useEffect(() => {
    const fbUid = firebaseAuth?.currentUser?.uid || uid || null;
    if (!fbUid) return undefined;
    let stop = () => {};
    try {
      // eslint-disable-next-line global-require
      const Presence = require('./src/services/presenceService');
      stop = Presence.startPresence(fbUid);
    } catch { }
    return () => { try { stop(); } catch { } };
  }, [uid]);

  // Dev-only deep-link login hook for test automation.
  // Usage (Android): adb shell am start -W -a android.intent.action.VIEW -d "blyp://e2e-login?role=host"
  useEffect(() => {
    if (!__DEV__) return;

    // Intentionally always enabled in __DEV__ builds.
    // Rationale: E2E automation should not depend on env var injection timing/caching in Metro.

    const runCognitoLogin = async ({ email, password, role }) => {
      const emailNorm = String(email || '').trim().toLowerCase();
      if (!emailNorm || !password) {
        throw new Error(`[E2E_LOGIN] Missing credentials for role=${role || 'unknown'}`);
      }

      // Clear any existing Cognito cached session artifacts first.
      try {
        const current = userPool?.getCurrentUser?.();
        if (current?.signOut) current.signOut();
      } catch { }
      try {
        await clearCognitoSessions();
      } catch { }

      return await new Promise((resolve, reject) => {
        try {
          const authDetails = new AuthenticationDetails({ Username: emailNorm, Password: String(password) });
          const cognitoUser = new CognitoUser({ Username: emailNorm, Pool: userPool });
          cognitoUser.authenticateUser(authDetails, {
            onSuccess: (result) => {
              try { refreshAuthNow?.(cognitoUser); } catch { }
              resolve({ cognitoUser, result });
            },
            onFailure: (err) => {
              reject(err);
            },
          });
        } catch (e) {
          reject(e);
        }
      });
    };

    const handleE2ELink = async (url) => {
      try {
        const parsed = parseE2EUrl(url);
        if (!parsed) return;
        if (parsed.scheme !== 'blyp' && parsed.scheme !== 'exp+blyp-mobile') return;

        // Expo Dev Client launch URLs look like:
        //   exp+blyp-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081&deeplink=blyp%3A%2F%2Fe2e-login%3F...
        // In that case, we want to extract the embedded deeplink and handle it.
        if (parsed.scheme === 'exp+blyp-mobile') {
          const embedded = String(parsed.query?.deeplink || parsed.query?.deepLink || parsed.query?.link || '').trim();
          if (embedded) {
            await handleE2ELink(embedded);
            return;
          }
        }

        if (parsed.host === 'e2e-logout') {
          console.warn('[BLYP][E2E_LOGIN] logout requested');
          await hardLogoutAndResetToAuth('e2e-logout');
          return;
        }

        if (parsed.host === 'e2e-live-host') {
          const title = String(parsed.query?.title || parsed.query?.e2eTitle || 'E2E Live').trim();
          console.warn('[BLYP][E2E_LIVE] host navigation requested', { title });
          let tries = 0;
          const attemptNav = () => {
            tries++;
            try {
              if (navigationRef?.isReady?.()) {
                navigationRef.navigate('LiveStreamScreen', {
                  mode: 'host',
                  source: 'e2e',
                  e2eAutoStart: '1',
                  e2eTitle: title,
                });
                return;
              }
            } catch { }
            if (tries < 30) setTimeout(attemptNav, 500);
          };
          attemptNav();
          return;
        }

        if (parsed.host === 'e2e-live-viewer') {
          console.warn('[BLYP][E2E_LIVE] viewer deeplink received', { raw: parsed.raw, query: parsed.query });
          let streamId = String(parsed.query?.streamId || parsed.query?.sessionId || '').trim();
          let hostUid = String(parsed.query?.hostUid || '').trim();

          // Some Android intent delivery paths truncate custom-scheme URLs at '&'.
          // Support a single-parameter fallback that carries both fields.
          // Example: blyp://e2e-live-viewer?payload=streamId%3D...%26hostUid%3Dalex
          if ((!streamId || !hostUid) && parsed.query?.payload) {
            try {
              const payload = String(parsed.query.payload || '').trim();
              const extra = parseQueryString(payload);
              if (!streamId) streamId = String(extra?.streamId || extra?.sessionId || '').trim();
              if (!hostUid) hostUid = String(extra?.hostUid || '').trim();
            } catch { }
          }
          if (!streamId || !hostUid) {
            console.error('[BLYP][E2E_LIVE] viewer navigation missing params', { streamId, hostUid, raw: parsed.raw, query: parsed.query });
            return;
          }
          console.warn('[BLYP][E2E_LIVE] viewer navigation requested', { streamId, hostUid });
          let tries = 0;
          const attemptNav = () => {
            tries++;
            try {
              if (navigationRef?.isReady?.()) {
                navigationRef.navigate('LiveStreamScreen', {
                  mode: 'viewer',
                  streamId,
                  hostUid,
                  source: 'e2e',
                });
                return;
              }
            } catch { }
            if (tries < 30) setTimeout(attemptNav, 500);
          };
          attemptNav();
          return;
        }

        if (parsed.host !== 'e2e-login') return;

        const role = String(parsed.query?.role || 'default').toLowerCase();
        const nonce = String(parsed.query?.nonce || parsed.query?.runId || '').trim();
        if (nonce && __lastE2ENonce === nonce) {
          console.warn('[BLYP][E2E_LOGIN] duplicate nonce ignored', { role, nonce });
          return;
        }
        if (nonce) __lastE2ENonce = nonce;
        const email =
          parsed.query?.email ||
          (role === 'host' ? process.env.EXPO_PUBLIC_E2E_HOST_EMAIL : process.env.EXPO_PUBLIC_E2E_VIEWER_EMAIL);
        const password =
          parsed.query?.password ||
          (role === 'host' ? process.env.EXPO_PUBLIC_E2E_HOST_PASSWORD : process.env.EXPO_PUBLIC_E2E_VIEWER_PASSWORD);

        console.warn('[BLYP][E2E_LOGIN] login requested', { role, email: maskEmail(email), nonce: nonce || undefined });
        await runCognitoLogin({ email, password, role });
        console.warn('[BLYP][E2E_LOGIN] login success', { role, email: maskEmail(email), nonce: nonce || undefined });
      } catch (e) {
        console.error('[BLYP][E2E_LOGIN] login failed', e?.message || e);
      }
    };

    if (process.env.EXPO_PUBLIC_E2E !== '1') {
      // E2E deep-link handler disabled in this build
      return () => { };
    }

    const sub = Linking.addEventListener('url', (evt) => handleE2ELink(evt?.url));
    Linking.getInitialURL()
      .then((u) => handleE2ELink(u))
      .catch(() => { });
    return () => {
      try { sub?.remove?.(); } catch { }
    };
  }, []);

  // Always-on content deep links: blyp://post/<id>, blyp://user/<id>,
  // blyp://blyp?q=<query>, blyp://saved, blyp://activity. Lets shared links
  // open straight to the right screen.
  useEffect(() => {
    const parseContentUrl = (url) => {
      const raw = String(url || '').trim();
      const m = raw.match(/^([A-Za-z0-9+.-]+):\/\/([^?/#]+)(?:\/([^?#]*))?(?:\?([^#]*))?/);
      if (!m) return null;
      return {
        scheme: (m[1] || '').toLowerCase(),
        host: (m[2] || '').toLowerCase(),
        path: decodeURIComponent(m[3] || ''),
        query: parseQueryString(m[4] || ''),
      };
    };

    const navWhenReady = (name, params, tries = 0) => {
      try {
        if (navigationRef?.isReady?.()) {
          navigationRef.navigate(name, params);
          return;
        }
      } catch { }
      if (tries < 40) setTimeout(() => navWhenReady(name, params, tries + 1), 400);
    };

    const handleContentLink = async (url) => {
      try {
        const parsed = parseContentUrl(url);
        if (!parsed || parsed.scheme !== 'blyp') return;
        // E2E hosts are handled by the dedicated handler above.
        if (parsed.host.startsWith('e2e-') || parsed.host === 'expo-development-client') return;

        switch (parsed.host) {
          case 'post': {
            const id = parsed.path || parsed.query?.id;
            if (!id) return;
            let post = { id };
            try {
              const snap = await db.collection('posts').doc(id).get();
              const data = snap?.data?.();
              if (data) post = { id, ...data };
            } catch { }
            navWhenReady('MediaViewer', { post });
            return;
          }
          case 'user': {
            const userId = parsed.path || parsed.query?.id;
            if (!userId) return;
            navWhenReady('UserProfile', { userId, username: parsed.query?.u || '@user' });
            return;
          }
          case 'blyp': {
            const q = parsed.query?.q || parsed.path || '';
            navWhenReady('Blyp', q ? { initialQuery: q } : undefined);
            return;
          }
          case 'saved':
            navWhenReady('Saved');
            return;
          case 'activity':
            navWhenReady('Activity');
            return;
          case 'withdraw': {
            // Stripe Connect return/refresh deep links → Coin Store withdraw UI.
            navWhenReady('CoinStore', {
              openWithdraw: true,
              withdrawReturn: parsed.path || '',
            });
            return;
          }
          case 'call': {
            const callId = parsed.path || parsed.query?.callId || parsed.query?.id;
            if (!callId) return;
            navWhenReady('Call', {
              callId,
              role: 'callee',
              peerName: parsed.query?.peerName || parsed.query?.callerName || 'Incoming call',
              callerId: parsed.query?.callerId,
            });
            return;
          }
          default:
            return;
        }
      } catch (e) {
        console.warn('[BLYP][DEEPLINK] content link failed', e?.message || String(e));
      }
    };

    const sub = Linking.addEventListener('url', (evt) => handleContentLink(evt?.url));
    Linking.getInitialURL().then((u) => handleContentLink(u)).catch(() => { });
    return () => {
      try { sub?.remove?.(); } catch { }
    };
  }, []);

  // Display error screen if needed
  if (appError) {
    // Never show the internal render test screen in non-dev builds.
    if (__DEV__) {
      return (
        <TestRender
          message={`Error: ${appError}`}
          onPress={() => {
            setAppError(null);
          }}
        />
      );
    }
    return (
      <View style={styles.loadingContainer}>
        <BlypLogo useGradientBackground={true} textStyle={{ fontSize: 48 }} />
        <Text style={{ color: '#e2e8f0', marginTop: 12, textAlign: 'center', paddingHorizontal: 24 }}>
          Something went wrong. Tap Continue to retry.
        </Text>
        <TouchableOpacity
          onPress={() => setAppError(null)}
          style={{ marginTop: 18, backgroundColor: COLORS.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 }}
        >
          <Text style={{ color: COLORS.black, fontWeight: '700' }}>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Display loading screen
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <BlypLogo useGradientBackground={true} textStyle={{ fontSize: 48 }} />
        <ActivityIndicator
          size="large"
          color={COLORS.primary}
          style={{ marginTop: 20 }}
        />
      </View>
    );
  }

  const showApp = devForceNoAuth || effectiveUser || isGuest;
  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: COLORS.pageBackground,
    },
  };
  return (
    <View testID="ROOT_APP" accessible={true} accessibilityLabel="ROOT_APP" style={{ flex: 1 }}>
      <PerformanceProvider>
        <NavigationContainer ref={navigationRef} theme={navTheme}>
          <StatusBar style="light" backgroundColor={BLYP_CHROME_BLACK} translucent />
          {showApp ? (
            onboarded === null && !!effectiveUser && !isGuest ? (
              // Real user whose onboarding status is still resolving: hold a
              // spinner instead of flashing the main app before onboarding.
              <View style={styles.loadingContainer}>
                <BlypLogo useGradientBackground={true} textStyle={{ fontSize: 48 }} />
                <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 20 }} />
              </View>
            ) : onboarded === false ? (
              <OnboardingScreen uid={uid} onDone={() => setOnboarded(true)} />
            ) : (
              <AppStack />
            )
          ) : (
            <AuthScreen />
          )}
          {devForceNoAuth && !effectiveUser && (
            <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: '#be185d', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
              <Text style={{ color: 'white', fontSize: 12, fontWeight: '600' }}>DEV AUTH BYPASS</Text>
            </View>
          )}
          {showApp && <GlobalImportProgress navigationRef={navigationRef} />}
          <Toast />
        </NavigationContainer>
      </PerformanceProvider>
    </View>
  );
}

// Bootstrap wrapper: delays app mount (and thus any network/socket activity)
// until runtime is ready. This is a brute-force guard for devices/networks where
// WebSocket polyfills or Metro connectivity are not yet established.
export default function App() {
  const [ready, setReady] = useState(false);
  const [loadingNote, setLoadingNote] = useState('Initializing runtime…');

  // Run LogBox ignores after component mount
  useEffect(() => {
    try {
      LogBox.ignoreLogs([
        'VirtualizedLists should never be nested',
        'Warning: Cannot update a component',
        'Setting a timer',
        'Non-serializable values were found in the navigation state',
      ]);
    } catch { }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Secondary timeout to surface prolonged bootstrap waits
    const warnTimeout = setTimeout(() => {
      if (!cancelled && !ready) {
        // eslint-disable-next-line no-console
        console.warn('[BLYP][BOOTSTRAP] still-waiting (>8s)');
        setLoadingNote('Still preparing environment…');
      }
    }, 8000);
    // Absolute fallback to avoid indefinite spinner if a dynamic import stalls
    const hardFallbackTimeout = setTimeout(() => {
      if (!cancelled && !ready) {
        // eslint-disable-next-line no-console
        console.warn('[BLYP][BOOTSTRAP] hard-fallback firing (>15s) forcing ready=true');
        setReady(true);
        setLoadingNote('Continuing with partial initialization');
      }
    }, 15000);
    (async () => {
      if (cancelled) return;

      // Critical path: pre-auth cleanup only (stability). This hydrates the
      // synchronous Cognito storage cache that auth restore depends on, so it
      // must finish before we render — but there's no need for an artificial
      // settle delay ahead of it.
      try {
        console.warn('[BLYP][BOOTSTRAP] step preAuthCleanup start');
        const m = await import('./src/config/preAuthCleanup');
        const maybeFn = m?.default || m?.runPreAuthCleanup;
        if (typeof maybeFn === 'function') {
          await maybeFn();
        }
        console.warn('[BLYP][BOOTSTRAP] step preAuthCleanup done');
      } catch { }

      if (!cancelled) {
        setReady(true);
        try {
          console.warn(`[BLYP][BOOTSTRAP] ready=true in ${Date.now() - __BLYP_BOOT_T0}ms (core init only)`);
        } catch {
          console.warn('[BLYP][BOOTSTRAP] ready=true (core init only)');
        }
        setLoadingNote('Ready – finishing background initialization…');
      }

      // Deferred non-critical initialization (fire-and-forget)
      (async () => {
        try {
          console.warn('[BLYP][BOOTSTRAP][DEFER] sentry start');
          await import('./src/monitoring/sentry');
          console.warn('[BLYP][BOOTSTRAP][DEFER] sentry done');
        } catch { }
        try {
          console.warn('[BLYP][BOOTSTRAP][DEFER] streamingFlag start');
          const { primeStreamingFlag } = await import('./src/config/StreamingFeatureFlag');
          primeStreamingFlag();
          console.warn('[BLYP][BOOTSTRAP][DEFER] streamingFlag done');
        } catch { }
        try {
          if (firebaseNative && crashlytics) {
            crashlytics.log('Deferred bootstrap complete');
          }
        } catch { }
      })();
    })();

    return () => { cancelled = true; clearTimeout(warnTimeout); clearTimeout(hardFallbackTimeout); };
  }, []);

  if (!ready) {
    return (
      <View style={styles.loadingContainer}>
        <BlypLogo useGradientBackground={true} textStyle={{ fontSize: 48 }} />
        <ActivityIndicator
          size="large"
          color={COLORS.primary}
          style={{ marginTop: 20 }}
        />
        <Text style={{ marginTop: 12, color: COLORS.textMuted, fontSize: 14, textAlign: 'center', maxWidth: '80%', alignSelf: 'center' }}>{loadingNote}</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BLYP_CHROME_BLACK,
  },
  errorText: {
    color: '#ec4899',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
  },
  errorMessage: {
    color: '#f1f5f9',
    fontSize: 16,
    textAlign: 'center',
    marginHorizontal: 40,
    marginTop: 10,
  },
  retryButton: {
    backgroundColor: '#a855f7',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 25,
    marginTop: 20,
  },
  retryText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
