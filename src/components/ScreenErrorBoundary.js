// ScreenErrorBoundary — a reusable React error boundary for top-level screens.
// React error boundaries only catch JS render/runtime errors (not native
// crashes), but in release a fatal render exception otherwise hard-exits the
// whole app. Wrapping the major surfaces (Home/Media/Profile/Chat) keeps one
// broken screen from taking everything down, and reports the error to
// Sentry/Crashlytics so we actually find out about it.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default class ScreenErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: (error && (error.message || String(error))) || 'Something went wrong',
    };
  }

  componentDidCatch(error, info) {
    const label = this.props.label || 'screen';
    try {
      console.error(`[ScreenErrorBoundary:${label}] caught error`, {
        message: error?.message || String(error),
        stack: error?.stack,
        componentStack: info?.componentStack,
      });
    } catch {
      /* ignore */
    }
    // Report to Sentry (deferred import preserves lazy native init) and
    // Crashlytics if available, without ever throwing from the handler.
    try {
      import('../monitoring/sentry')
        .then((m) => {
          try {
            m.captureException?.(error, { boundary: label, componentStack: info?.componentStack });
          } catch {
            /* ignore */
          }
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      this.props.onError?.(error, info);
    } catch {
      /* ignore */
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: '' });
    try {
      this.props.onReset?.();
    } catch {
      /* ignore */
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          This screen hit a snag, but the rest of the app is fine. Tap below to try again.
        </Text>
        <TouchableOpacity style={styles.button} onPress={this.handleRetry} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    color: '#b8b8c4',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 28,
  },
  button: {
    backgroundColor: '#13c2c2',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
  },
  buttonText: {
    color: '#04282a',
    fontSize: 16,
    fontWeight: '700',
  },
});
