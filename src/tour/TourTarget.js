/**
 * TourTarget — measures a view into the tour target registry.
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
    const t1 = setTimeout(measure, 60);
    const t2 = setTimeout(measure, 320);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
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
