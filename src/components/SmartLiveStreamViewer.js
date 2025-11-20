/**
 * Smart LiveStream Viewer with Automatic Fallbacks
 * 
 * This component automatically tries different viewer implementations
 * and falls back to working versions if there are issues.
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import LiveStreamViewerFixed from './LiveStreamViewer_FIXED';
import LiveStreamViewerProduction from './LiveStreamViewer_PRODUCTION';
import LiveStreamViewerOriginal from './LiveStreamViewer';
import LiveStreamViewerWorking from './LiveStreamViewer_WORKING';

const VIEWER_TYPES = {
  FIXED: 'FIXED',
  PRODUCTION: 'PRODUCTION', 
  ORIGINAL: 'ORIGINAL',
  WORKING: 'WORKING'
};

const SmartLiveStreamViewer = ({ streamId, style, onError }) => {
  const [currentViewer, setCurrentViewer] = useState(VIEWER_TYPES.FIXED);
  const [attemptedViewers, setAttemptedViewers] = useState(new Set([VIEWER_TYPES.FIXED]));
  const [viewerError, setViewerError] = useState(null);
  const [isDebugMode, setIsDebugMode] = useState(__DEV__);
  const errorCountRef = useRef(0);
  const maxErrorsPerViewer = 3;

  /**
   * Handle viewer errors and automatic fallback
   */
  const handleViewerError = (error, viewerType) => {
    console.log(`🚨 SMART VIEWER: ${viewerType} error:`, error);
    
    errorCountRef.current++;
    setViewerError({ error, viewerType, count: errorCountRef.current });
    
    if (errorCountRef.current >= maxErrorsPerViewer) {
      console.log(`🔄 SMART VIEWER: ${viewerType} failed ${maxErrorsPerViewer} times, switching...`);
      
      // Find next available viewer
      const viewerSequence = [
        VIEWER_TYPES.FIXED,
        VIEWER_TYPES.PRODUCTION,
        VIEWER_TYPES.ORIGINAL,
        VIEWER_TYPES.WORKING
      ];
      
      const currentIndex = viewerSequence.indexOf(viewerType);
      let nextViewer = null;
      
      // Find next untried viewer
      for (let i = currentIndex + 1; i < viewerSequence.length; i++) {
        const candidate = viewerSequence[i];
        if (!attemptedViewers.has(candidate)) {
          nextViewer = candidate;
          break;
        }
      }
      
      if (nextViewer) {
        console.log(`🔄 SMART VIEWER: Switching to ${nextViewer}`);
        setCurrentViewer(nextViewer);
        setAttemptedViewers(prev => new Set([...prev, nextViewer]));
        errorCountRef.current = 0; // Reset error count for new viewer
        setViewerError(null);
      } else {
        console.log(`🚨 SMART VIEWER: All viewers failed, showing error`);
        onError && onError(new Error('All viewer implementations failed'));
      }
    }
  };

  /**
   * Manual viewer switching for debugging
   */
  const switchViewer = (targetViewer) => {
    if (targetViewer !== currentViewer) {
      console.log(`🔄 SMART VIEWER: Manual switch to ${targetViewer}`);
      setCurrentViewer(targetViewer);
      setAttemptedViewers(prev => new Set([...prev, targetViewer]));
      errorCountRef.current = 0;
      setViewerError(null);
    }
  };

  /**
   * Render the appropriate viewer component
   */
  const renderViewer = () => {
    const commonProps = {
      streamId,
      style: { flex: 1 },
      onError: (error) => handleViewerError(error, currentViewer)
    };

    switch (currentViewer) {
      case VIEWER_TYPES.FIXED:
        return <LiveStreamViewerFixed {...commonProps} />;
      
      case VIEWER_TYPES.PRODUCTION:
        return <LiveStreamViewerProduction {...commonProps} />;
      
      case VIEWER_TYPES.ORIGINAL:
        return <LiveStreamViewerOriginal {...commonProps} />;
      
      case VIEWER_TYPES.WORKING:
        return <LiveStreamViewerWorking {...commonProps} />;
      
      default:
        return (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Unknown viewer type: {currentViewer}</Text>
          </View>
        );
    }
  };

  /**
   * Render debug controls (development only)
   */
  const renderDebugControls = () => {
    if (!isDebugMode) return null;

    return (
      <View style={styles.debugContainer}>
        <View style={styles.debugHeader}>
          <Text style={styles.debugTitle}>🔧 Smart Viewer Debug</Text>
          <TouchableOpacity 
            style={styles.debugToggle}
            onPress={() => setIsDebugMode(false)}
          >
            <Text style={styles.debugToggleText}>Hide</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.debugInfo}>
          <Text style={styles.debugText}>Current: {currentViewer}</Text>
          <Text style={styles.debugText}>Errors: {errorCountRef.current}/{maxErrorsPerViewer}</Text>
          <Text style={styles.debugText}>Attempted: {Array.from(attemptedViewers).join(', ')}</Text>
        </View>

        {viewerError && (
          <View style={styles.errorInfo}>
            <Text style={styles.errorTitle}>Last Error:</Text>
            <Text style={styles.errorMessage}>{viewerError.error.message}</Text>
          </View>
        )}
        
        <View style={styles.viewerButtons}>
          {Object.values(VIEWER_TYPES).map(type => (
            <TouchableOpacity
              key={type}
              style={[
                styles.viewerButton,
                currentViewer === type && styles.activeViewerButton,
                attemptedViewers.has(type) && type !== currentViewer && styles.triedViewerButton
              ]}
              onPress={() => switchViewer(type)}
            >
              <Text style={[
                styles.viewerButtonText,
                currentViewer === type && styles.activeViewerButtonText
              ]}>
                {type}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  /**
   * Show debug toggle in production builds
   */
  const renderDebugToggle = () => {
    if (isDebugMode) return null;

    return (
      <TouchableOpacity 
        style={styles.hiddenDebugToggle}
        onPress={() => setIsDebugMode(true)}
      >
        <Text style={styles.hiddenDebugText}>🔧</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, style]}>
      {renderViewer()}
      {renderDebugControls()}
      {renderDebugToggle()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    padding: 20,
  },
  errorText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  debugContainer: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  debugTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  debugToggle: {
    backgroundColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  debugToggleText: {
    color: '#fff',
    fontSize: 12,
  },
  debugInfo: {
    marginBottom: 8,
  },
  debugText: {
    color: '#ccc',
    fontSize: 12,
    marginBottom: 2,
  },
  errorInfo: {
    backgroundColor: 'rgba(255, 0, 0, 0.2)',
    padding: 8,
    borderRadius: 4,
    marginBottom: 8,
  },
  errorTitle: {
    color: '#ff6b6b',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  errorMessage: {
    color: '#ff9999',
    fontSize: 11,
  },
  viewerButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  viewerButton: {
    backgroundColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    minWidth: 60,
  },
  activeViewerButton: {
    backgroundColor: '#007AFF',
  },
  triedViewerButton: {
    backgroundColor: '#666',
  },
  viewerButtonText: {
    color: '#fff',
    fontSize: 10,
    textAlign: 'center',
    fontWeight: '500',
  },
  activeViewerButtonText: {
    fontWeight: 'bold',
  },
  hiddenDebugToggle: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 15,
  },
  hiddenDebugText: {
    color: '#fff',
    fontSize: 16,
  },
});

export default SmartLiveStreamViewer;