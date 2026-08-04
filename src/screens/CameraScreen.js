import React, { useState, useRef, useEffect } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import * as MediaLibrary from 'expo-media-library';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import { COLORS } from '../styles/theme';

const CameraScreen = () => {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [type, setType] = useState('back');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState(null);
  const [isEmulator, setIsEmulator] = useState(false);
  const [capturedPhotos, setCapturedPhotos] = useState([]);
  const [isMultiPhotoMode, setIsMultiPhotoMode] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const singlePhotoTimeoutRef = useRef(null);
  const cameraRef = useRef(null);
  const navigation = useNavigation();

  useEffect(() => {
    if (!cameraPermission) {
      requestCameraPermission();
    }
    if (!microphonePermission) {
      requestMicrophonePermission();
    }
    
    // Check if running on emulator
    const checkDevice = async () => {
      const deviceType = await Device.getDeviceTypeAsync();
      const isEmulatorDevice = !Device.isDevice;
      const deviceName = Device.deviceName;
      const brand = Device.brand;
      const modelName = Device.modelName;
      
      console.log('=== DEVICE INFORMATION ===');
      console.log('Device type:', deviceType);
      console.log('Is real device:', Device.isDevice);
      console.log('Device name:', deviceName);
      console.log('Brand:', brand);
      console.log('Model:', modelName);
      console.log('=========================');
      
      setIsEmulator(isEmulatorDevice);
      
      if (isEmulatorDevice) {
        console.log('⚠️ Running on emulator - video recording may not work properly');
      } else {
        console.log('✅ Running on physical device - checking video recording compatibility...');
      }
    };
    
    checkDevice();
  }, [cameraPermission, microphonePermission, requestCameraPermission, requestMicrophonePermission]);

  // Handle single photo timeout (DISABLED - user controls when to finish)
  useEffect(() => {
    // Timeout disabled - user will manually press Done button
    // if (capturedPhotos.length === 1 && isMultiPhotoMode) {
    //   singlePhotoTimeoutRef.current = setTimeout(() => {
    //     console.log('⏰ Single photo timeout - auto-finishing');
    //     finishPhotoCapture();
    //   }, 3000);
    // }
    
    return () => {
      if (singlePhotoTimeoutRef.current) {
        clearTimeout(singlePhotoTimeoutRef.current);
        singlePhotoTimeoutRef.current = null;
      }
    };
  }, [capturedPhotos.length, isMultiPhotoMode]);

  // Diagnostic function to test device capabilities
  const testRecordingCapability = async () => {
    try {
      console.log('=== TESTING RECORDING CAPABILITY ===');
      console.log('Camera permission granted:', cameraPermission?.granted);
      console.log('Microphone permission granted:', microphonePermission?.granted);
      console.log('Camera ref exists:', !!cameraRef.current);
      
      if (cameraRef.current) {
        console.log('Attempting very short test recording...');
        const testPromise = cameraRef.current.recordAsync({
          maxDuration: 2, // Very short test
        });
        
        // Stop after 1.5 seconds
        setTimeout(() => {
          if (cameraRef.current) {
            console.log('Stopping test recording...');
            cameraRef.current.stopRecording();
          }
        }, 1500);
        
        const result = await testPromise;
        console.log('Test recording result:', result);
      }
    } catch (error) {
      console.log('Test recording error:', error.message);
    }
  };

  const takePicture = async () => {
    try {
      console.log('=== PHOTO BUTTON PRESSED ===');
      console.log('🚀 takePicture function called!');
      
      if (!cameraRef.current) {
        console.error('❌ Camera reference not available');
        Alert.alert('Error', 'Camera not ready. Please try again.');
        return;
      }

      if (!isCameraReady) {
        console.error('❌ Camera not ready yet');
        Alert.alert('Error', 'Camera is still loading. Please wait a moment and try again.');
        return;
      }

      console.log('📸 About to take picture...');
      
      // Try with different photo options if the first one fails
      let photo = null;
      try {
        photo = await cameraRef.current.takePictureAsync({
          quality: 0.7,
          skipProcessing: false,
          base64: false,
          exif: false,
        });
      } catch (photoError) {
        console.warn('⚠️ First photo attempt failed, trying with minimal options:', photoError.message);
        try {
          photo = await cameraRef.current.takePictureAsync();
        } catch (secondError) {
          console.error('❌ Both photo attempts failed:', secondError.message);
          Alert.alert('Camera Error', 'Unable to take photo. Please check camera permissions and try again.');
          return;
        }
      }
      
      if (!photo || !photo.uri) {
        console.error('❌ Photo capture failed - no URI returned', photo);
        Alert.alert('Error', 'Failed to capture photo. Please try again.');
        return;
      }
      
      console.log('✅ Photo taken successfully:', photo);

      // Try to save to media library but don't fail if it doesn't work
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          await MediaLibrary.saveToLibraryAsync(photo.uri);
          console.log('� Photo saved to gallery');
        } else {
          console.log('📱 Media library permission not granted, skipping save');
        }
      } catch (saveError) {
        console.warn('⚠️ Failed to save to media library:', saveError.message);
        // Continue anyway - this shouldn't crash the app
      }

      // Add photo to captured photos array with correct type
      const photoWithType = { 
        ...photo, 
        type: 'photo',
        timestamp: Date.now() 
      };
      
      console.log('� Photo captured, adding to gallery:', photoWithType);
      
      // Add photo to captured photos array - user will manually choose when to finish
      setCapturedPhotos(prev => {
        const newPhotos = [...prev, photoWithType];
        console.log('📱 Total photos in gallery now:', newPhotos.length);
        
        // Enable multi-photo mode after first photo
        if (newPhotos.length === 1) {
          console.log('🔄 Enabling multi-photo mode after first photo');
          setIsMultiPhotoMode(true);
        }
        
        return newPhotos;
      });

    } catch (error) {
      console.error('🔥 takePicture ERROR:', error);
      console.error('Error details:', error.message);
      Alert.alert('Camera Error', `Failed to take photo: ${error.message}`);
    }
  };

  const openGallery = async () => {
    try {
      console.log('🎯 GALLERY FUNCTION CALLED - openGallery starting...');
      console.log('📸 Opening gallery for multiple photo selection...');
      
      // Request photo library permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant photo library permissions to select photos');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: 10, // Allow up to 10 photos
      });

      if (!result.canceled && result.assets?.length > 0) {
        console.log('📸 Selected', result.assets.length, 'photos from gallery');
        
        // Convert gallery photos to the same format as captured photos
        const galleryPhotos = result.assets.map(asset => ({
          ...asset,
          type: 'photo',
          timestamp: Date.now()
        }));
        
        console.log('🚀 Navigating directly to Review with gallery photos for description overlay');
        
        // Navigate directly to Review screen to show description overlay
        navigation.navigate('Review', { 
          media: galleryPhotos, 
          type: galleryPhotos.length === 1 ? 'photo' : 'photos',
          source: 'gallery' // Mark as gallery source for proper overlay handling
        });
      }
    } catch (error) {
      console.error('Gallery selection error:', error);
      Alert.alert('Error', 'Failed to access photo gallery');
    }
  };

  const finishPhotoCapture = () => {
    console.log('🏁 Finishing photo capture with', capturedPhotos.length, 'photos');
    if (capturedPhotos.length > 0) {
      // Reset multi-photo mode
      setIsMultiPhotoMode(false);
      
      // Navigate to review screen with all captured photos
      navigation.navigate('Review', { 
        media: capturedPhotos, 
        type: capturedPhotos.length === 1 ? 'photo' : 'photos' 
      });
    }
  };

  const removePhoto = (index) => {
    setCapturedPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const startRecording = async () => {
    // Check if we're on an emulator and warn user
    if (isEmulator) {
      Alert.alert(
        'Emulator Limitation', 
        'Video recording does not work properly on Android emulators. Please test on a physical device for full functionality.\n\nFor now, taking a photo instead.',
        [
          { text: 'Take Photo Instead', onPress: takePicture },
          { text: 'Try Anyway', onPress: () => proceedWithRecording() }
        ]
      );
      return;
    }
    
    // On physical device, offer both methods
    Alert.alert(
      'Video Recording', 
      'Choose video recording method:',
      [
        { 
          text: 'Built-in Camera', 
          onPress: () => proceedWithRecording(),
          style: 'default'
        },
        { 
          text: 'System Camera', 
          onPress: () => useSystemVideoRecording(),
          style: 'default'
        },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  // Alternative video recording using system camera
  const useSystemVideoRecording = async () => {
    try {
      console.log('Using system camera for video recording...');
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: 30,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const video = result.assets[0];
        console.log('System video recording successful:', video);
        
        // Save to media library
        try {
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status === 'granted') {
            await MediaLibrary.saveToLibraryAsync(video.uri);
            console.log('Video saved to gallery successfully');
          }
          
          // Navigate to review/post creation screen with the video
          try {
            navigation.navigate('Review', { media: video, type: 'video' });
          } catch (navError) {
            // If Review screen doesn't exist, show success and stay on camera
            console.log('Review screen not found, showing success message');
            Alert.alert(
              'Success!', 
              'Video recorded and saved successfully!\n\nDuration: ' + (video.duration || 'unknown'),
              [
                { text: 'Record Another', onPress: () => {} },
                { text: 'Done', onPress: () => navigation.goBack() }
              ]
            );
          }
        } catch (saveError) {
          console.error('Failed to save video:', saveError);
          Alert.alert('Partial Success', 'Video recorded but could not be saved to gallery. You can still use the video.', [
            { text: 'Continue', onPress: () => {
              try {
                navigation.navigate('Review', { media: video, type: 'video' });
              } catch {
                Alert.alert('Success!', 'Video recorded successfully!');
              }
            }}
          ]);
        }
      }
    } catch (error) {
      console.error('System video recording error:', error);
      Alert.alert('Error', 'System video recording failed: ' + error.message);
    }
  };

  const proceedWithRecording = async () => {
    if (cameraRef.current && !isRecording) {
      // Verify both permissions are granted
      if (!cameraPermission?.granted || !microphonePermission?.granted) {
        Alert.alert('Permissions Required', 'Camera and microphone permissions are required for video recording');
        return;
      }
      
      try {
        console.log('Starting video recording...');
        console.log('Camera permission:', cameraPermission?.granted);
        console.log('Microphone permission:', microphonePermission?.granted);
        console.log('Camera ref current:', !!cameraRef.current);
        console.log('Is emulator:', isEmulator);
        
        setIsRecording(true);
        setRecordingStartTime(Date.now());
        
        // Add a small delay to ensure camera is fully ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Try with minimal options first
        console.log('Calling recordAsync with minimal options...');
        const recordingPromise = cameraRef.current.recordAsync();
        
        // Store the promise so we can properly handle it
        recordingPromise
          .then(async (video) => {
            console.log('Video recording completed successfully:', video);
            console.log('Video object keys:', Object.keys(video || {}));
            console.log('Video URI:', video?.uri);
            console.log('Video duration:', video?.duration);
            
            if (video && video.uri) {
              try {
                // Request media library permissions
                const { status } = await MediaLibrary.requestPermissionsAsync();
                if (status === 'granted') {
                  await MediaLibrary.saveToLibraryAsync(video.uri);
                  console.log('Video saved to library');
                }

                // Navigate to review screen with the video
                try {
                  navigation.navigate('Review', { media: video, type: 'video' });
                } catch (navError) {
                  // If Review screen doesn't exist, show success and provide options
                  Alert.alert(
                    'Success!', 
                    `Video recorded successfully! Duration: ${video.duration || 'unknown'}ms`,
                    [
                      { text: 'Record Another', onPress: () => {} },
                      { text: 'Done', onPress: () => navigation.goBack() }
                    ]
                  );
                }
              } catch (saveError) {
                console.error('Video save error:', saveError);
                Alert.alert('Warning', 'Video recorded but could not be saved to library');
              }
            } else {
              console.log('Video object is null or missing URI');
              Alert.alert('Warning', 'Recording completed but video data is missing');
            }
          })
          .catch((error) => {
            console.log('Recording error caught:', error.message);
            console.log('Error name:', error.name);
            console.log('Full error:', error);
            
            // Try to provide more specific error handling
            if (error.message.includes('Recording was stopped before any data could be produced')) {
              Alert.alert(
                'Camera Recording Failed', 
                'The built-in camera recording failed. This can happen due to device compatibility issues.\n\nWould you like to try the system camera instead?',
                [
                  { text: 'Try System Camera', onPress: useSystemVideoRecording },
                  { text: 'Cancel', style: 'cancel' }
                ]
              );
            } else if (!error.message.includes('Recording was stopped')) {
              Alert.alert('Recording Error', error.message);
            }
          })
          .finally(() => {
            console.log('Recording finished, resetting state');
            setIsRecording(false);
            setRecordingStartTime(null);
          });
          
      } catch (error) {
        console.error('Failed to start recording:', error);
        Alert.alert('Error', 'Failed to start recording: ' + error.message);
        setIsRecording(false);
        setRecordingStartTime(null);
      }
    } else {
      console.log('Cannot start recording - camera not ready or already recording');
    }
  };

  const stopRecording = async () => {
    if (cameraRef.current && isRecording) {
      try {
        // Check if recording has been running for at least 1 second
        const recordingDuration = recordingStartTime ? Date.now() - recordingStartTime : 0;
        console.log(`Attempting to stop recording. Duration: ${recordingDuration}ms`);
        
        if (recordingDuration < 1000) {
          console.log('Recording too short, showing alert');
          Alert.alert('Recording Too Short', 'Please record for at least 1 second');
          return;
        }
        
        console.log('Stopping video recording...');
        console.log('Camera ref status before stop:', !!cameraRef.current);
        
        // Try to stop the recording
        await cameraRef.current.stopRecording();
        console.log('Stop recording command sent successfully');
      } catch (error) {
        console.error('Stop recording error:', error);
        console.log('Error during stop:', error.message);
        setIsRecording(false);
        setRecordingStartTime(null);
      }
    } else {
      console.log('Cannot stop recording - not recording or camera not ready');
      console.log('Camera ref exists:', !!cameraRef.current);
      console.log('Is recording state:', isRecording);
    }
  };

  const toggleCameraType = () => {
    setType(current => 
      current === 'back' ? 'front' : 'back'
    );
  };

  // Wrapper functions to handle async calls properly
  const handleCapturePress = async () => {
    if (isRecording) {
      try {
        await stopRecording();
      } catch (error) {
        console.error('Stop recording error:', error);
      }
    } else {
      try {
        await takePicture();
      } catch (error) {
        console.error('Camera capture error:', error);
      }
    }
  };

  const handleLongPress = async () => {
    try {
      await startRecording();
    } catch (error) {
      console.error('Video recording error:', error);
    }
  };

  if (!cameraPermission || !microphonePermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Requesting camera and microphone permissions...</Text>
      </View>
    );
  }

  if (!cameraPermission.granted || !microphonePermission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Icon  name="videocam-off" size={64} color="#6b7280"  />
        <Text style={styles.permissionText}>Camera or Microphone access denied</Text>
        <Text style={styles.permissionSubtext}>
          Please enable camera and microphone permissions in your device settings for video recording
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={() => {
          requestCameraPermission();
          requestMicrophonePermission();
        }}>
          <Text style={styles.permissionButtonText}>Grant Permissions</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={type}
        mode="picture"
        enableTorch={false}
        autoFocus="on"
        onCameraReady={() => {
          console.log('📷 Camera is ready');
          setIsCameraReady(true);
        }}
        onMountError={(error) => {
          console.error('📷 Camera mount error:', error);
          Alert.alert('Camera Error', 'Failed to initialize camera. Please try again.');
          setIsCameraReady(false);
        }}
      >
        <View style={styles.overlay}>
          <View style={styles.topControls}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => navigation.goBack()}
            >
              <Icon  name="close" size={32} color="white"  />
            </TouchableOpacity>
          </View>

          <View style={styles.bottomControls}>
            <TouchableOpacity
              style={styles.galleryButton}
              onPress={openGallery}
            >
              <Icon  name="images" size={32} color="white"  />
            </TouchableOpacity>

            <View style={styles.captureButtonContainer}>
              {/* Photo/Video toggle buttons */}
              {!isRecording ? (
                <View style={styles.captureButtons}>
                  <TouchableOpacity
                    style={styles.photoButton}
                    onPress={handleCapturePress}
                  >
                    <Icon  name="camera" size={32} color="white"  />
                    <Text style={styles.buttonLabel}>Photo</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[
                      styles.videoButton,
                      isEmulator && styles.videoButtonDisabled
                    ]}
                    onPress={handleLongPress}
                  >
                    <Icon  
                      name="videocam" 
                      size={32} 
                      color={isEmulator ? "#666" : "white"} 
                     />
                    <Text style={[
                      styles.buttonLabel,
                      isEmulator && styles.buttonLabelDisabled
                    ]}>
                      {isEmulator ? 'Video*' : 'Video'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.stopButton}
                  onPress={handleCapturePress}
                >
                  <View style={styles.stopButtonInner} />
                  <Text style={styles.buttonLabel}>Stop</Text>
                </TouchableOpacity>
              )}

              {/* Video indicator */}
              {isRecording && (
                <View style={styles.recordingIndicator}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingText}>REC</Text>
                </View>
              )}
              
              {/* Emulator warning */}
              {isEmulator && (
                <Text style={styles.emulatorWarning}>
                  *Video recording not supported on emulator
                </Text>
              )}
            </View>

            {/* Photo Gallery Preview - Show when photos are captured */}
            {capturedPhotos.length > 0 && (
              <View style={styles.photoGallery}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {capturedPhotos.map((photo, index) => (
                    <View key={index} style={styles.photoPreviewContainer}>
                      <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
                      <TouchableOpacity
                        style={styles.removePhotoButton}
                        onPress={() => removePhoto(index)}
                      >
                        <Icon  name="close-circle" size={24} color="red"  />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
                <View style={styles.photoActions}>
                  <TouchableOpacity
                    style={styles.doneButton}
                    onPress={finishPhotoCapture}
                  >
                    <Text style={styles.doneButtonText}>
                      Done ({capturedPhotos.length} photo{capturedPhotos.length > 1 ? 's' : ''})
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={styles.flipButton}
              onPress={toggleCameraType}
            >
              <Icon  name="camera-reverse" size={32} color="white"  />
            </TouchableOpacity>
          </View>
          
          {/* Debug test button */}
          <TouchableOpacity
            style={styles.testButton}
            onPress={testRecordingCapability}
          >
            <Text style={styles.testButtonText}>Test Recording</Text>
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: COLORS.pageBackground,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  permissionText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 16,
  },
  permissionSubtext: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  permissionButton: {
    backgroundColor: '#00D2BE',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  permissionButtonText: {
    color: '#0A0A0C',
    fontSize: 16,
    fontWeight: '600',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  closeButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
    padding: 8,
  },
  bottomControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  galleryButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
    padding: 12,
  },
  captureButtonContainer: {
    alignItems: 'center',
  },
  captureButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: 200,
  },
  photoButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 15,
    padding: 15,
    minWidth: 80,
  },
  videoButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 15,
    padding: 15,
    minWidth: 80,
  },
  videoButtonDisabled: {
    backgroundColor: 'rgba(100, 100, 100, 0.2)',
  },
  stopButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 15,
    padding: 15,
    minWidth: 100,
  },
  stopButtonInner: {
    width: 32,
    height: 32,
    backgroundColor: '#ef4444',
    borderRadius: 4,
  },
  buttonLabel: {
    color: 'white',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
  buttonLabelDisabled: {
    color: '#666',
  },
  emulatorWarning: {
    color: '#ff9500',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  captureButtonRecording: {
    backgroundColor: '#ef4444',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'white',
  },
  captureButtonInnerRecording: {
    width: 30,
    height: 30,
    borderRadius: 4,
    backgroundColor: 'white',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    marginRight: 6,
  },
  recordingText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  flipButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
    padding: 12,
  },
  instructionText: {
    color: 'white',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  testButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: 'rgba(255, 165, 0, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  testButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  photoGallery: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  photoPreviewContainer: {
    marginHorizontal: 4,
    position: 'relative',
  },
  photoPreview: {
    width: 60,
    height: 60,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'white',
  },
  removePhotoButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: 'white',
    borderRadius: 12,
  },
  photoActions: {
    marginTop: 12,
    alignItems: 'center',
  },
  doneButton: {
    backgroundColor: '#00D2BE',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
  },
  doneButtonText: {
    color: '#0A0A0C',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default CameraScreen;