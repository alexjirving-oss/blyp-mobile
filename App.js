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
  } catch {}
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
console.log('[BLYP][APP] PRELUDE?', global.__BLYP_PRELUDE__);

// Note: Startup side-effects (pre-auth cleanup, Amplify init, Sentry, flags)
// are deferred until after runtime is ready to avoid early WebSocket/runtime issues.

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, ActivityIndicator, LogBox, Platform, TouchableOpacity } from 'react-native';
import { enableScreens } from 'react-native-screens';
import * as SplashScreen from 'expo-splash-screen';
import TestRender from './src/components/TestRender';

// Enable native screens optimization
enableScreens();

// Note: LogBox.ignoreLogs must run post-mount to avoid touching RN internals too early

import Toast from 'react-native-toast-message';
import BlypLogo from './src/components/BlypLogo';
import { PerformanceProvider } from './src/performance/PerformanceStore';
// Firebase native/runtime flags
import { firebaseNative } from './src/config/firebase';
// Lazy require native modules to avoid bundler issues when absent
let crashlytics = null; let perf = null; let messaging = null;
if (firebaseNative) {
  try { crashlytics = require('@react-native-firebase/crashlytics').default(); } catch {}
  try { perf = require('@react-native-firebase/perf').default(); } catch {}
  try { messaging = require('@react-native-firebase/messaging').default(); } catch {}
}

// Import screens
import HomeScreen from './src/screens/HomeScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatConversationScreen from './src/screens/ChatConversationScreen';
import MessengerScreen from './src/screens/MessengerScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import EditProfileScreen from './src/screens/EditProfileScreen';
import AuthScreen from './src/screens/AuthScreen';
const CameraScreen = React.lazy(() => import('./src/screens/CameraScreen'));
// Lazy screens
const ReviewScreen = React.lazy(() => import('./src/screens/ReviewScreen'));
import VoiceMemoScreen from './src/screens/VoiceMemoScreen';
import PostPreviewScreen from './src/screens/PostPreviewScreen';
const MediaViewerScreen = React.lazy(() => import('./src/screens/MediaViewerScreen'));
const LiveStreamScreen = React.lazy(() => import('./src/screens/LiveStreamScreen'));
import SearchScreen from './src/screens/SearchScreen';
import SearchResultsScreen from './src/screens/SearchResultsScreen';
import CommentsScreen from './src/screens/CommentsScreen';
import UserProfileScreen from './src/screens/UserProfileScreen';
import FollowersScreen from './src/screens/FollowersScreen';
import FindPeopleScreen from './src/screens/FindPeopleScreen';
// Gaming screens (lazy)
const GamesScreen = React.lazy(() => import('./src/screens/GamesScreen'));
const GameRoomScreen = React.lazy(() => import('./src/screens/GameRoomScreen'));
const ModerationQueueScreen = React.lazy(() => import('./src/screens/ModerationQueueScreen'));
// Chat rooms screens
import ChatRoomsScreen from './src/screens/ChatRoomsScreen';
import ChatRoomScreen from './src/screens/ChatRoomScreen';
// Blypcoin screens
import CoinStoreScreen from './src/screens/CoinStoreScreen';

// Import components and utilities
import TabBarIcon from './src/components/TabBarIcon';
import CreatePostButton from './src/components/CreatePostButton';
import { useAuth } from './src/hooks/useCommon';
import { useUnreadCount } from './src/hooks/useUnreadCount';
import { scalingConfig } from './src/utils/scaleUtils';
const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function MainTabs() {
  const unreadCount = useUnreadCount();
  
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#1e293b',
          borderTopColor: '#334155',
          paddingTop: 8,
          paddingBottom: 24,
          height: 88,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          marginTop: 4,
        },
        tabBarActiveTintColor: '#ec4899',
        tabBarInactiveTintColor: '#9ca3af',
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon name="home" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatListScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon name="game-controller" color={color} size={size} />
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
        options={{
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon name="paper-plane" color={color} size={size} badge={unreadCount > 0 ? unreadCount : null} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon name="person" color={color} size={size} />
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
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="Comments" component={CommentsScreen} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} />
      <Stack.Screen name="Followers" component={FollowersScreen} />
      <Stack.Screen name="ChatConversation" component={ChatConversationScreen} />
      <Stack.Screen name="FindPeople" component={FindPeopleScreen} />
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
      <Stack.Screen name="MediaViewer" children={() => (
        <Suspense fallback={null}>
          <MediaViewerScreen />
        </Suspense>
      )} />
      <Stack.Screen name="VoiceMemo" component={VoiceMemoScreen} />
      <Stack.Screen name="LiveStreamScreen" children={() => (
        <Suspense fallback={null}>
          <LiveStreamScreen />
        </Suspense>
      )} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
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
      <Stack.Screen name="ModerationQueue" children={() => (
        <Suspense fallback={null}>
          <ModerationQueueScreen />
        </Suspense>
      )} />
    </Stack.Navigator>
  );
}

function AppInner() {
  const [appError, setAppError] = useState(null);
  const { user, loading, error: authError } = useAuth();
  // Prevent brief post-login bounce by keeping UI authenticated for a short window
  const authStickyUntilRef = useRef(0);
  const [hadUser, setHadUser] = useState(false);
  useEffect(() => {
    if (user) {
      setHadUser(true);
      authStickyUntilRef.current = Date.now() + 180000; // 3 minutes
    }
  }, [user]);
  const effectiveUser = user || (hadUser && Date.now() < authStickyUntilRef.current ? {} : null);
  // Development-only auth bypass (does NOT grant real identity). Keeps Security priority by requiring explicit env flag.
  const devForceNoAuth = (process.env?.EXPO_PUBLIC_DEV_FORCE_NO_AUTH === '1');
  if (devForceNoAuth && !effectiveUser) {
    // eslint-disable-next-line no-console
    console.warn('[BLYP][AUTH] DEV_FORCE_NO_AUTH active – rendering app without authenticated user');
  }
  
  // Global error handler for uncaught exceptions
  useEffect(() => {
    const errorHandler = (error) => {
      console.error('Unhandled error:', error);
      if (crashlytics) {
        try {
          crashlytics.log(String(error?.message || 'Unhandled error')); 
          crashlytics.recordError(error);
        } catch {}
      }
      setAppError(error.message || 'An unexpected error occurred');
    };
    
    // Add global error handler
    if (Platform.OS === 'web') {
      window.addEventListener('error', errorHandler);
      return () => window.removeEventListener('error', errorHandler);
    }
    
    return () => {};
  }, []);

  // Show error screen if authentication fails
  useEffect(() => {
    if (authError) {
      console.error('Auth error:', authError);
      setAppError(authError);
    }
  }, [authError]);

  // Native Firebase one-time startup (Crashlytics, Perf, Messaging)
  useEffect(() => {
    if (!firebaseNative) return;
    try { crashlytics?.setCrashlyticsCollectionEnabled(true); } catch {}
    try { perf?.setPerformanceCollectionEnabled?.(true); } catch {}
    // Messaging foreground handler (basic logging placeholder)
    try {
      messaging?.onMessage(async msg => {
        console.log('📩 FCM foreground message:', msg?.data || msg);
      });
    } catch {}
  }, []);
  
  // Display error screen if needed
  if (appError) {
    // Use our TestRender component as a fallback
    return (
      <TestRender 
        message={`Error: ${appError}`}
        onPress={() => { setAppError(null); }}
      />
    );
  }

  // Display loading screen
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <BlypLogo useGradientBackground={true} textStyle={{ fontSize: 48 }} />
        <ActivityIndicator 
          size="large" 
          color="#a855f7" 
          style={{ marginTop: 20 }} 
        />
      </View>
    );
  }

  const showApp = devForceNoAuth || effectiveUser;
  return (
    <PerformanceProvider>
      <NavigationContainer>
        <StatusBar style="light" backgroundColor="#0f172a" />
        {showApp ? <AppStack /> : <AuthScreen />}
        {devForceNoAuth && !effectiveUser && (
          <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: '#be185d', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
            <Text style={{ color: 'white', fontSize: 12, fontWeight: '600' }}>DEV AUTH BYPASS</Text>
          </View>
        )}
        <Toast />
      </NavigationContainer>
    </PerformanceProvider>
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
    } catch {}
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
      // Hard delay to let RN polyfills and Dev Client settle
      await new Promise((res) => setTimeout(res, 3000));

      if (cancelled) return;

      // Defer non-essential startup side-effects to avoid early network calls
      try {
        // eslint-disable-next-line no-console
        console.warn('[BLYP][BOOTSTRAP] step preAuthCleanup start');
        // Proactively clean malformed Cognito tokens before Amplify/Cognito usage
        await import('./src/config/preAuthCleanup');
        // eslint-disable-next-line no-console
        console.warn('[BLYP][BOOTSTRAP] step preAuthCleanup done');
      } catch {}
      try {
        // eslint-disable-next-line no-console
        console.warn('[BLYP][BOOTSTRAP] step amplify start');
        // Initialize AWS Amplify if configured (no secrets committed)
        await import('./src/config/amplify');
        // eslint-disable-next-line no-console
        console.warn('[BLYP][BOOTSTRAP] step amplify done');
      } catch {}
      try {
        if (firebaseNative && crashlytics) {
          crashlytics.log('App bootstrap complete');
        }
      } catch {}
      try {
        // eslint-disable-next-line no-console
        console.warn('[BLYP][BOOTSTRAP] step sentry start');
        // Initialize observability (no-op if DSN not provided)
        await import('./src/monitoring/sentry');
        // eslint-disable-next-line no-console
        console.warn('[BLYP][BOOTSTRAP] step sentry done');
      } catch {}
      try {
        // eslint-disable-next-line no-console
        console.warn('[BLYP][BOOTSTRAP] step streamingFlag start');
        // Prime remote streaming flag (non-blocking; enables kill-switch overrides)
        const { primeStreamingFlag } = await import('./src/config/StreamingFeatureFlag');
        primeStreamingFlag();
        // eslint-disable-next-line no-console
        console.warn('[BLYP][BOOTSTRAP] step streamingFlag done');
      } catch {}

      if (!cancelled) setReady(true);
      if (!cancelled) {
        // eslint-disable-next-line no-console
        console.warn('[BLYP][BOOTSTRAP] ready=true (deferred init complete)');
      }
    })();

    return () => { cancelled = true; clearTimeout(warnTimeout); clearTimeout(hardFallbackTimeout); };
  }, []);

  if (!ready) {
    return (
      <View style={styles.loadingContainer}>
        <BlypLogo useGradientBackground={true} textStyle={{ fontSize: 48 }} />
        <ActivityIndicator 
          size="large" 
          color="#a855f7" 
          style={{ marginTop: 20 }} 
        />
        <Text style={{ marginTop: 12, color: '#64748b', fontSize: 14 }}>{loadingNote}</Text>
      </View>
    );
  }

  return <AppInner />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
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