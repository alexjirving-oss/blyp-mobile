// LiveErrorBoundary — wraps the live experience so a JS render/runtime error
// during go-live (or mid-stream) shows a recoverable fallback instead of taking
// the whole app down. React error boundaries only catch JS errors (not native
// crashes), but a fatal render exception in release otherwise hard-exits the
// app, which is exactly the "it just closes" symptom users see.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default class LiveErrorBoundary extends React.Component {
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
    // Make sure a crashed live screen can't leave the app stuck in "live" mode,
    // which would suppress the immersive nav bar and other global behaviours.
    try {
      global.__BLYP_LIVE_ACTIVE__ = false;
    } catch {
      /* ignore */
    }
    try {
      console.error('[LiveErrorBoundary] caught live screen error', {
        message: error?.message || String(error),
        stack: error?.stack,
        componentStack: info?.componentStack,
      });
    } catch {
      /* ignore */
    }
  }

  handleGoBack = () => {
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
        <Text style={styles.title}>Live hit a snag</Text>
        <Text style={styles.body}>
          Something went wrong with the live screen. Your app is fine — please head
          back and try going live again.
        </Text>
        <TouchableOpacity style={styles.button} onPress={this.handleGoBack} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Back to safety</Text>
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
