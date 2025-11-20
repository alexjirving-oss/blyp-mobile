/**
 * Enhanced LiveStream Viewer with Smart Fallback
 * 
 * This component provides multiple layers of fallback to ensure viewers always see something:
 * 1. Try LiveStreamViewer_FIXED first
 * 2. Fall back to LiveStreamViewer_WORKING if issues persist
 * 3. Fall back to basic error display if all viewers fail
 * 4. Provides detailed debugging for production troubleshooting
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Dimensions,
} from 'react-native';

// Import all available viewer variants
import LiveStreamViewerFixed from './LiveStreamViewer_FIXED';
import LiveStreamViewerWorking from './LiveStreamViewer_WORKING';
import LiveStreamViewerProduction from './LiveStreamViewer_PRODUCTION';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const EnhancedLiveStreamViewer = ({ streamId, style, onError }) => {
  const [currentViewer, setCurrentViewer] = useState('FIXED');
  const [errorCount, setErrorCount] = useState(0);
  const [lastError, setLastError] = useState(null);
  const [fallbackAttempts, setFallbackAttempts] = useState(0);
  const [debugMode, setDebugMode] = useState(__DEV__);
  
  const maxFallbackAttempts = 3;
  const errorTimeoutRef = useRef(null);

  // Reset error count after successful periods
  useEffect(() => {
    const resetTimer = setTimeout(() => {
      if (errorCount > 0) {
        console.log('🔄 Enhanced Viewer: Resetting error count after successful period');
        setErrorCount(0);
      }
    }, 30000); // Reset after 30 seconds of no errors

    return () => clearTimeout(resetTimer);
  }, [errorCount]);

  // Handle viewer errors with smart fallback
  const handleViewerError = (error, viewerType) => {
    console.error(`❌ Enhanced Viewer: Error in ${viewerType}:`, error);
    setLastError(error);
    setErrorCount(prev => prev + 1);

    // Clear any existing timeout
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
    }

    // Attempt fallback after a brief delay
    errorTimeoutRef.current = setTimeout(() => {
      if (fallbackAttempts < maxFallbackAttempts) {
        attemptFallback();
      } else {
        console.error('❌ Enhanced Viewer: All fallback attempts exhausted');
        onError?.(new Error(`All viewer fallbacks failed. Last error: ${error.message}`));
      }
    }, 2000);
  };

  const attemptFallback = () => {
    setFallbackAttempts(prev => prev + 1);
    
    console.log(`🔄 Enhanced Viewer: Attempting fallback ${fallbackAttempts + 1}/${maxFallbackAttempts}`);
    
    // Fallback sequence: FIXED -> WORKING -> PRODUCTION -> ERROR
    switch (currentViewer) {
      case 'FIXED':
        console.log('🔄 Enhanced Viewer: Falling back to WORKING viewer');
        setCurrentViewer('WORKING');
        break;
      case 'WORKING':
        console.log('🔄 Enhanced Viewer: Falling back to PRODUCTION viewer');
        setCurrentViewer('PRODUCTION');
        break;
      case 'PRODUCTION':
        console.log('🔄 Enhanced Viewer: All viewers failed, showing error state');
        setCurrentViewer('ERROR');
        break;
      default:
        console.log('❌ Enhanced Viewer: No more fallbacks available');
    }
  };

  const manualRetry = () => {
    console.log('🔄 Enhanced Viewer: Manual retry requested');
    setCurrentViewer('FIXED');
    setErrorCount(0);
    setFallbackAttempts(0);
    setLastError(null);
  };

  const toggleDebugMode = () => {
    setDebugMode(prev => !prev);
  };

  // Render current viewer based on state
  const renderCurrentViewer = () => {
    const commonProps = {
      streamId,
      style: styles.viewer,
      onError: (error) => handleViewerError(error, currentViewer)
    };

    switch (currentViewer) {
      case 'FIXED':
        return <LiveStreamViewerFixed {...commonProps} />;
      case 'WORKING':
        return <LiveStreamViewerWorking {...commonProps} />;
      case 'PRODUCTION':
        return <LiveStreamViewerProduction {...commonProps} />;
      case 'ERROR':
        return renderErrorState();
      default:
        return renderErrorState();
    }
  };

  const renderErrorState = () => (
    <View style={styles.errorContainer}>
      <Text style={styles.errorIcon}>📡</Text>
      <Text style={styles.errorTitle}>Stream Unavailable</Text>
      <Text style={styles.errorMessage}>
        Unable to load the live stream after trying multiple viewers.
      </Text>
      
      {debugMode && lastError && (
        <View style={styles.debugContainer}>
          <Text style={styles.debugTitle}>Debug Info:</Text>
          <Text style={styles.debugText}>Current Viewer: {currentViewer}</Text>
          <Text style={styles.debugText}>Error Count: {errorCount}</Text>
          <Text style={styles.debugText}>Fallback Attempts: {fallbackAttempts}</Text>
          <Text style={styles.debugText}>Last Error: {lastError.message}</Text>
          <Text style={styles.debugText}>Stream ID: {streamId || 'undefined'}</Text>
        </View>
      )}

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.retryButton} onPress={manualRetry}>
          <Text style={styles.buttonText}>Retry Stream</Text>
        </TouchableOpacity>
        
        {debugMode && (
          <TouchableOpacity style={styles.debugButton} onPress={toggleDebugMode}>
            <Text style={styles.buttonText}>Hide Debug</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderViewerInfo = () => {
    if (!debugMode) return null;

    return (
      <View style={styles.viewerInfo}>
        <Text style={styles.viewerInfoText}>
          Viewer: {currentViewer} | Errors: {errorCount} | Attempts: {fallbackAttempts}
        </Text>
        <TouchableOpacity onPress={toggleDebugMode}>
          <Text style={styles.debugToggle}>Hide</Text>
        </TouchableOpacity>
      </View>
    );
  };

  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  return (
    <View style={[styles.container, style]}>
      {renderCurrentViewer()}
      {renderViewerInfo()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewer: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    padding: 20,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  debugContainer: {
    backgroundColor: '#333',
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
    width: '100%',
  },
  debugTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  debugText: {
    fontSize: 12,
    color: '#ccc',
    marginBottom: 4,
    fontFamily: 'monospace',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  debugButton: {
    backgroundColor: '#555',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  viewerInfo: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 8,
    borderRadius: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewerInfoText: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  debugToggle: {
    color: '#007AFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
});

export default EnhancedLiveStreamViewer;