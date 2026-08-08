/**
 * GuidedTourProvider — owns tour state, navigation between surfaces, and
 * persistence via userPreferencesService (local + Firestore heal).
 *
 * Overlay drives autonomous PRE → TEXT → POST → advance timing.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CommonActions } from '@react-navigation/native';
import { View, StyleSheet } from 'react-native';
import { useAuth } from '../hooks/useCommon';
import { useHasAI } from '../hooks/useEntitlement';
import { useGuestMode } from '../services/guestSessionService';
import {
  getPreferences,
  subscribePreferences,
  markTourStarted,
  setTourCompleted,
  resetTour,
} from '../services/userPreferencesService';
import { emitTabReset } from '../utils/tabResetBus';
import { buildTourSteps } from './tourSteps';
import {
  registerTourController,
  unregisterTourController,
  emitTourSelect,
} from './tourBus';
import {
  ensureLocalWelcomeTourItem,
  consumeLocalWelcomeTourItem,
} from './welcomeTourInbox';
import GuidedTourOverlay from './GuidedTourOverlay';

const GuidedTourContext = createContext({
  active: false,
  startTour: () => {},
  replayTour: () => {},
  skipTour: () => {},
});

export function useGuidedTour() {
  return useContext(GuidedTourContext);
}

function selectAfterNavigate(screen, tab) {
  if (!screen || !tab) return;
  const fire = () => emitTourSelect({ screen, tab });
  setTimeout(fire, 140);
  setTimeout(fire, 380);
}

function safeNavigate(navigationRef, action) {
  try {
    if (!navigationRef?.isReady?.()) return;
    if (typeof action === 'function') {
      action(navigationRef);
      return;
    }
    if (action?.type === 'tab' && action.name) {
      navigationRef.navigate('MainTabs', { screen: action.name });
      if (action.select) selectAfterNavigate(action.name, action.select);
      return;
    }
    if (action?.type === 'stack' && action.name) {
      navigationRef.navigate(action.name, action.params || {});
      return;
    }
    if (action?.type === 'homeForYou') {
      navigationRef.navigate('MainTabs', { screen: 'Home' });
      setTimeout(() => {
        try {
          emitTabReset('Home');
        } catch {
          /* ignore */
        }
        selectAfterNavigate('Home', 'A');
      }, 120);
      return;
    }
    if (action?.type === 'homeHub') {
      navigationRef.navigate('MainTabs', { screen: 'Home' });
      selectAfterNavigate('Home', 'home');
      return;
    }
    if (action?.type === 'chatTab') {
      navigationRef.navigate('MainTabs', { screen: 'Chat' });
      selectAfterNavigate('Chat', action.select || 'notifications');
      return;
    }
    if (action?.type === 'profileTab') {
      navigationRef.navigate('MainTabs', {
        screen: 'Profile',
        params: action.select === 'Promote' ? { openPromote: true } : undefined,
      });
      selectAfterNavigate('Profile', action.select || 'My Profile');
    }
  } catch (e) {
    console.warn('[tour] navigate failed', e?.message || e);
  }
}

export function GuidedTourProvider({ children, navigationRef }) {
  const { uid } = useAuth();
  const isGuest = !!useGuestMode();
  const hasAI = useHasAI();

  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [steps, setSteps] = useState(() => buildTourSteps({ hasDating: true, hasGames: true }));
  const [prefs, setPrefs] = useState(null);

  const autoStartedRef = useRef(false);
  const applyingStepRef = useRef(false);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const finishingRef = useRef(false);

  const effectiveUid = uid && !isGuest ? uid : null;

  useEffect(() => {
    if (!effectiveUid) {
      setPrefs(null);
      return undefined;
    }
    return subscribePreferences(effectiveUid, setPrefs);
  }, [effectiveUid]);

  // Seed local welcome inbox item once onboarded and tour not done.
  useEffect(() => {
    if (!effectiveUid || !prefs?.onboarded || prefs?.tourCompleted) return;
    ensureLocalWelcomeTourItem(effectiveUid).catch(() => {});
  }, [effectiveUid, prefs?.onboarded, prefs?.tourCompleted]);

  const applyStep = useCallback(
    (list, index) => {
      const step = list?.[index];
      if (!step) return;
      applyingStepRef.current = true;
      safeNavigate(navigationRef, step.navigate);
      setTimeout(() => {
        applyingStepRef.current = false;
      }, 420);
    },
    [navigationRef]
  );

  const finishTour = useCallback(
    async ({ skipped = false } = {}) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      setActive(false);
      setStepIndex(0);
      try {
        if (effectiveUid) {
          await setTourCompleted(effectiveUid, true);
          await consumeLocalWelcomeTourItem(effectiveUid);
        }
      } catch (e) {
        console.warn('[tour] complete persist failed', e?.message || e);
      }
      // Return to Home so Exit never leaves the user stranded mid-tour.
      try {
        if (navigationRef?.isReady?.()) {
          navigationRef.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: 'MainTabs', params: { screen: 'Home' } }],
            })
          );
        }
      } catch {
        safeNavigate(navigationRef, { type: 'tab', name: 'Home' });
      }
      finishingRef.current = false;
      if (skipped && __DEV__) {
        // eslint-disable-next-line no-console
        console.log('[tour] skipped');
      }
    },
    [effectiveUid, navigationRef]
  );

  const startTour = useCallback(
    async (opts = {}) => {
      if (!effectiveUid) return;
      if (active && !opts.force) return;

      finishingRef.current = false;
      const dating = opts.hasDating != null ? !!opts.hasDating : !!hasAI;
      const games = opts.hasGames != null ? !!opts.hasGames : true;
      const nextSteps = buildTourSteps({ hasDating: dating, hasGames: games });
      setSteps(nextSteps);
      setStepIndex(0);

      try {
        await markTourStarted(effectiveUid);
      } catch {
        /* non-fatal */
      }

      setActive(true);
      applyStep(nextSteps, 0);
    },
    [effectiveUid, active, hasAI, applyStep]
  );

  const replayTour = useCallback(
    async (opts = {}) => {
      if (!effectiveUid) return;
      try {
        await resetTour(effectiveUid);
        await ensureLocalWelcomeTourItem(effectiveUid, { force: true });
      } catch {
        /* non-fatal */
      }
      await startTour({ ...opts, force: true });
    },
    [effectiveUid, startTour]
  );

  const advanceTour = useCallback(
    ({ isLast = false } = {}) => {
      if (!active || finishingRef.current) return;
      if (isLast) {
        finishTour({ skipped: false });
        return;
      }
      setStepIndex((i) => {
        const list = stepsRef.current;
        const next = Math.min(i + 1, list.length - 1);
        if (next !== i) applyStep(list, next);
        return next;
      });
    },
    [active, applyStep, finishTour]
  );

  const skipTour = useCallback(() => {
    finishTour({ skipped: true });
  }, [finishTour]);

  // Register bus for notifications / settings / Menu replay.
  useEffect(() => {
    registerTourController({ start: startTour, replay: replayTour });
    return () => unregisterTourController();
  }, [startTour, replayTour]);

  // Auto-start once after onboarding (not for guests; not if already completed).
  useEffect(() => {
    if (!effectiveUid || !prefs) return undefined;
    if (!prefs.onboarded || prefs.tourCompleted) return undefined;
    if (autoStartedRef.current || active) return undefined;

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || autoStartedRef.current) return;
      try {
        const { needsAcceptance } = require('../services/termsService');
        if (await needsAcceptance(effectiveUid)) {
          return;
        }
      } catch {
        /* proceed */
      }
      if (cancelled) return;
      autoStartedRef.current = true;
      startTour({ source: 'auto' });
    }, 1800);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [effectiveUid, prefs, active, startTour]);

  // Prefetch prefs once so auto-start has data even before subscribe fires.
  useEffect(() => {
    if (!effectiveUid) return;
    getPreferences(effectiveUid).then(setPrefs).catch(() => {});
  }, [effectiveUid]);

  const value = useMemo(
    () => ({
      active,
      stepIndex,
      steps,
      startTour,
      replayTour,
      skipTour,
    }),
    [active, stepIndex, steps, startTour, replayTour, skipTour]
  );

  const currentStep = steps[stepIndex] || null;

  return (
    <GuidedTourContext.Provider value={value}>
      <View style={styles.shell}>
        {children}
        <GuidedTourOverlay
          visible={active && !!currentStep}
          step={currentStep}
          stepIndex={stepIndex}
          stepCount={steps.length}
          onAdvance={advanceTour}
          onSkip={skipTour}
        />
      </View>
    </GuidedTourContext.Provider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
});

export default GuidedTourProvider;

