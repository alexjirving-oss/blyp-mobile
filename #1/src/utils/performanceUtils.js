import { useCallback, useMemo, memo, lazy } from 'react';
import { InteractionManager, View } from 'react-native';

// Higher-order component for memoizing components
export const withMemo = (Component, areEqual) => memo(Component, areEqual);

// Custom hook for delayed execution after interactions complete
export const useAfterInteractions = (callback, deps = []) => {
  return useCallback(() => {
    InteractionManager.runAfterInteractions(callback);
  }, deps);
};

// Debounce hook for performance optimization
export const useDebounceCallback = (callback, delay, deps = []) => {
  return useCallback(
    useMemo(() => {
      let timeoutId;
      return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => callback(...args), delay);
      };
    }, deps),
    [callback, delay, ...deps]
  );
};

// Throttle hook for performance optimization
export const useThrottleCallback = (callback, limit, deps = []) => {
  return useCallback(
    useMemo(() => {
      let inThrottle;
      return (...args) => {
        if (!inThrottle) {
          callback(...args);
          inThrottle = true;
          setTimeout(() => inThrottle = false, limit);
        }
      };
    }, deps),
    [callback, limit, ...deps]
  );
};

// Memoized component for expensive renders
export const MemoizedView = memo(({ children, style, ...props }) => {
  return (
    <View style={style} {...props}>
      {children}
    </View>
  );
});

// Performance monitoring utilities
export class PerformanceMonitor {
  static measurements = new Map();
  
  static startMeasure(name) {
    if (__DEV__) {
      this.measurements.set(name, Date.now());
    }
  }
  
  static endMeasure(name) {
    if (__DEV__ && this.measurements.has(name)) {
      const startTime = this.measurements.get(name);
      const duration = Date.now() - startTime;
      console.log(`⚡ Performance: ${name} took ${duration}ms`);
      this.measurements.delete(name);
    }
  }
  
  static measureSync(name, fn) {
    if (__DEV__) {
      this.startMeasure(name);
      const result = fn();
      this.endMeasure(name);
      return result;
    }
    return fn();
  }
  
  static async measureAsync(name, fn) {
    if (__DEV__) {
      this.startMeasure(name);
      const result = await fn();
      this.endMeasure(name);
      return result;
    }
    return await fn();
  }
}

// Utility for checking if component should update (similar to shouldComponentUpdate)
export const shouldUpdate = (prevProps, nextProps, keys = []) => {
  if (keys.length === 0) {
    keys = Object.keys(nextProps);
  }
  
  return keys.some(key => prevProps[key] !== nextProps[key]);
};

// Lazy loading utility for heavy components
export const createLazyComponent = (importFunc) => {
  return memo(lazy(importFunc));
};

export default {
  withMemo,
  useAfterInteractions,
  useDebounceCallback,
  useThrottleCallback,
  MemoizedView,
  PerformanceMonitor,
  shouldUpdate,
  createLazyComponent,
};