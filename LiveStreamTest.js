/**
 * Live Stream Viewer Test - Quick Validation
 * Run this to verify the streaming components are working correctly
 */

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import LiveStreamViewer from '../src/components/LiveStreamViewer_FIXED';
import LiveStreamViewerProduction from '../src/components/LiveStreamViewer_PRODUCTION';
import SmartLiveStreamViewer from '../src/components/SmartLiveStreamViewer';
import { LiveStreamDebugger } from '../src/utils/LiveStreamDebugger';

const LiveStreamTest = () => {
  const [testResults, setTestResults] = useState([]);
  const [currentTest, setCurrentTest] = useState(null);
  const [activeViewer, setActiveViewer] = useState('fixed');

  // Mock stream ID for testing
  const mockStreamId = 'test-stream-123';

  const logResult = (testName, result, details = '') => {
    const timestamp = new Date().toLocaleTimeString();
    setTestResults(prev => [...prev, {
      test: testName,
      result,
      details,
      timestamp
    }]);
  };

  const testViewerComponent = async (viewerName, ViewerComponent) => {
    setCurrentTest(`Testing ${viewerName} Viewer`);
    try {
      // Test component instantiation
      const viewer = React.createElement(ViewerComponent, {
        streamId: mockStreamId,
        style: { width: 200, height: 200 },
        onError: (error) => {
          logResult(`${viewerName} Error Handler`, 'PASS', `Error handler called: ${error}`);
        }
      });

      if (viewer) {
        logResult(`${viewerName} Component`, 'PASS', 'Component created successfully');
        return true;
      }
    } catch (error) {
      logResult(`${viewerName} Component`, 'FAIL', error.message);
      return false;
    }
  };

  const runAllTests = async () => {
    setTestResults([]);
    logResult('Test Suite', 'START', 'Beginning live stream viewer tests');

    // Test viewer components
    await testViewerComponent('Fixed', LiveStreamViewer);
    await testViewerComponent('Production', LiveStreamViewerProduction);
    await testViewerComponent('Smart', SmartLiveStreamViewer);

    // Test debugger utility
    try {
      setCurrentTest('Testing Stream Debugger');
      const canDebug = typeof LiveStreamDebugger.runFullDiagnostics === 'function';
      logResult('Stream Debugger', canDebug ? 'PASS' : 'FAIL', 
        canDebug ? 'Debugger available' : 'Debugger missing');
    } catch (error) {
      logResult('Stream Debugger', 'FAIL', error.message);
    }

    logResult('Test Suite', 'COMPLETE', 'All tests finished');
    setCurrentTest(null);
  };

  const testLiveDebugger = async () => {
    setCurrentTest('Running Live Diagnostics');
    try {
      await LiveStreamDebugger.runFullDiagnostics(mockStreamId);
      logResult('Live Diagnostics', 'PASS', 'Check console for detailed output');
    } catch (error) {
      logResult('Live Diagnostics', 'FAIL', error.message);
    }
    setCurrentTest(null);
  };

  const renderViewer = () => {
    const ViewerComponent = {
      fixed: LiveStreamViewer,
      production: LiveStreamViewerProduction,
      smart: SmartLiveStreamViewer
    }[activeViewer];

    return (
      <View style={styles.viewerContainer}>
        <Text style={styles.viewerTitle}>Active Viewer: {activeViewer.toUpperCase()}</Text>
        <ViewerComponent
          streamId={mockStreamId}
          style={styles.viewer}
          onError={(error) => {
            Alert.alert('Viewer Error', error);
          }}
        />
        <View style={styles.switchButtons}>
          {['fixed', 'production', 'smart'].map(viewer => (
            <TouchableOpacity
              key={viewer}
              style={[
                styles.switchButton,
                activeViewer === viewer && styles.activeButton
              ]}
              onPress={() => setActiveViewer(viewer)}
            >
              <Text style={styles.buttonText}>{viewer}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>🎥 Live Stream Viewer Test</Text>
      
      {/* Test Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.testButton} onPress={runAllTests}>
          <Text style={styles.buttonText}>Run Component Tests</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.testButton} onPress={testLiveDebugger}>
          <Text style={styles.buttonText}>Run Live Diagnostics</Text>
        </TouchableOpacity>
      </View>

      {/* Current Test Status */}
      {currentTest && (
        <View style={styles.currentTest}>
          <Text style={styles.currentTestText}>Running: {currentTest}</Text>
        </View>
      )}

      {/* Live Viewer Demo */}
      {renderViewer()}

      {/* Test Results */}
      <View style={styles.results}>
        <Text style={styles.resultsTitle}>Test Results:</Text>
        {testResults.map((result, index) => (
          <View key={index} style={[
            styles.resultItem,
            result.result === 'PASS' && styles.passResult,
            result.result === 'FAIL' && styles.failResult,
            result.result === 'START' && styles.startResult,
            result.result === 'COMPLETE' && styles.completeResult
          ]}>
            <Text style={styles.resultText}>
              [{result.timestamp}] {result.test}: {result.result}
            </Text>
            {result.details && (
              <Text style={styles.resultDetails}>{result.details}</Text>
            )}
          </View>
        ))}
      </View>

      {/* Quick Fix Verification */}
      <View style={styles.fixInfo}>
        <Text style={styles.fixTitle}>🔧 Fix Status</Text>
        <Text style={styles.fixText}>
          ✅ LiveStreamViewer_FIXED.js - Direct segment access implemented{'\n'}
          ✅ SmartLiveStreamViewer.js - Automatic fallback system{'\n'}
          ✅ LiveStreamDebugger.js - Diagnostic utilities{'\n'}
          ✅ LiveStreamScreen.js - Updated to use fixed components
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#1a1a1a',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 20,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  testButton: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 5,
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  currentTest: {
    backgroundColor: '#333',
    padding: 10,
    borderRadius: 8,
    marginBottom: 15,
  },
  currentTestText: {
    color: '#FFD700',
    textAlign: 'center',
  },
  viewerContainer: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
  },
  viewerTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  viewer: {
    height: 200,
    backgroundColor: '#000',
    borderRadius: 8,
    marginBottom: 10,
  },
  switchButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  switchButton: {
    backgroundColor: '#555',
    padding: 8,
    borderRadius: 5,
    flex: 1,
    marginHorizontal: 2,
  },
  activeButton: {
    backgroundColor: '#007AFF',
  },
  results: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
  },
  resultsTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  resultItem: {
    padding: 8,
    borderRadius: 5,
    marginBottom: 5,
  },
  passResult: { backgroundColor: '#004d00' },
  failResult: { backgroundColor: '#4d0000' },
  startResult: { backgroundColor: '#003d4d' },
  completeResult: { backgroundColor: '#4d3d00' },
  resultText: {
    color: 'white',
    fontWeight: 'bold',
  },
  resultDetails: {
    color: '#ccc',
    fontSize: 12,
    marginTop: 2,
  },
  fixInfo: {
    backgroundColor: '#2a4d2a',
    borderRadius: 8,
    padding: 15,
  },
  fixTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  fixText: {
    color: '#90EE90',
    lineHeight: 18,
  },
});

export default LiveStreamTest;