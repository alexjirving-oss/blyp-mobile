/**
 * BridgeTestScreen.tsx
 * 
 * Simple diagnostic screen to test the JS→Native bridge in isolation.
 * Add this screen to App.js during testing, then navigate to it.
 * 
 * Usage:
 * 1. Import this screen in App.js
 * 2. Add a route for it
 * 3. Navigate to it from LiveStreamScreen or anywhere
 * 4. Press "Test Bridge" button
 * 5. Check Metro console for [BRIDGE_TEST] logs
 * 6. Check logcat for IVS_NATIVE logs
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { runAllTests } from '../streaming/IVSBridgeTest';

export function BridgeTestScreen(): React.ReactElement {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setResults([]);
    setError(null);

    // Capture console logs
    const logs: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args: any[]) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };

    console.error = (...args: any[]) => {
      logs.push(`ERROR: ${args.join(' ')}`);
      originalError(...args);
    };

    try {
      await runAllTests();
      setResults(logs);
    } catch (e: any) {
      setError(e.message || String(e));
      setResults(logs);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      setTesting(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll}>
        <Text style={styles.title}>🔬 IVS Bridge Test</Text>
        <Text style={styles.subtitle}>
          This test verifies JS↔Native communication
        </Text>

        <TouchableOpacity
          style={[styles.button, testing && styles.buttonDisabled]}
          onPress={handleTest}
          disabled={testing}
        >
          {testing ? (
            <>
              <ActivityIndicator color="#fff" style={styles.spinner} />
              <Text style={styles.buttonText}>Testing...</Text>
            </>
          ) : (
            <Text style={styles.buttonText}>▶ Run Bridge Test</Text>
          )}
        </TouchableOpacity>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>❌ Test Failed</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {results.length > 0 && (
          <View style={styles.resultsBox}>
            <Text style={styles.resultsTitle}>
              📋 Results ({results.length} lines)
            </Text>
            {results.map((line, idx) => (
              <Text
                key={idx}
                style={[
                  styles.logLine,
                  line.includes('✅') && styles.successLine,
                  line.includes('❌') && styles.failLine,
                ]}
              >
                {line}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>ℹ️  What This Tests:</Text>
          <Text style={styles.infoText}>
            • Verifies IVSBroadcastModule is accessible{'\n'}
            • Calls testBridge() (simple dummy method){'\n'}
            • Calls startHostSession() with test params{'\n'}
            • Checks if callbacks fire{'\n'}
            • Detects timeouts or exceptions
          </Text>
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>📝 Where to Check Logs:</Text>
          <Text style={styles.infoText}>
            Metro Console (this screen):{'\n'}
            Look for [BRIDGE_TEST] and [NATIVE] prefixes{'\n\n'}
            Native Logcat:{'\n'}
            adb logcat IVS_NATIVE:D *:S
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1419',
    padding: 16,
  },
  scroll: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    flexDirection: 'row',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  spinner: {
    marginRight: 12,
  },
  errorBox: {
    backgroundColor: '#4d1a1a',
    borderLeftWidth: 4,
    borderLeftColor: '#ff4444',
    padding: 16,
    marginBottom: 16,
    borderRadius: 4,
  },
  errorTitle: {
    color: '#ff6666',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  errorText: {
    color: '#ff9999',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  resultsBox: {
    backgroundColor: '#1a1f26',
    padding: 16,
    marginBottom: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#333',
    maxHeight: 400,
  },
  resultsTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  logLine: {
    color: '#ccc',
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 4,
    lineHeight: 16,
  },
  successLine: {
    color: '#44ff44',
  },
  failLine: {
    color: '#ff4444',
  },
  infoBox: {
    backgroundColor: '#1a2a3a',
    borderLeftWidth: 4,
    borderLeftColor: '#0080ff',
    padding: 12,
    marginBottom: 12,
    borderRadius: 4,
  },
  infoTitle: {
    color: '#66ccff',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  infoText: {
    color: '#aaa',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
});
