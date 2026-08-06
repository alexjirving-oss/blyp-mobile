/**
 * TourTarget — measures a view into the tour target registry.
 * Remeasures on layout + staggered ticks so anchors survive tab/animation churn.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { clearTourTarget, setTourTarget } from './tourTargets';

export default function TourTarget({ id, children, style, ...rest }) {
  const ref = useRef(null);

  const measure = useCallback(() => {
    if (!id || !ref.current?.measureInWindow) return;
    try {
      ref.current.measureInWindow((x, y, width, height) => {
        setTourTarget(id, { x, y, width, height });
      });
    } catch {
      /* ignore */
    }
  }, [id]);

  useEffect(() => {
    if (!id) return undefined;
    const delays = [40, 180, 420, 900];
    const timers = delays.map((ms) => setTimeout(measure, ms));
    return () => {
      timers.forEach(clearTimeout);
      clearTourTarget(id);
    };
  }, [id, measure]);

  if (!id) return children;

  return (
    <View
      ref={ref}
      collapsable={false}
      style={style}
      onLayout={measure}
      {...rest}
    >
      {children}
    </View>
  );
}
