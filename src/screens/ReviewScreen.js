import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  TextInput,
  Image,
  Alert,
  StatusBar,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Video } from 'expo-av';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, auth } from '../config/firebase';
import Toast from 'react-native-toast-message';
import BlypLogo from '../components/BlypLogo';
import aiService from '../services/aiService';
import speechToTextService from '../services/speechToTextService';
import geminiSpeechService from '../services/geminiSpeechService';
import mediaDescriptionService from '../services/mediaDescriptionService';

const ReviewScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { media, type, mode, transcript } = route.params || {};
  
  // Initialize mediaItems state - convert single media to array or use empty array
  const [mediaItems, setMediaItems] = useState(() => {
    if (media) {
      return Array.isArray(media) ? media : [media];
    }
    return [];
  });
  
  const [caption, setCaption] = useState(transcript || '');
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceMemo, setVoiceMemo] = useState(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState({
    facebook: false,
    instagram: false,
    tiktok: false,
    youtube: false,
  });
  
  // AI Enhancement States
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [generatedContent, setGeneratedContent] = useState(null);
  const [showAiContent, setShowAiContent] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingStartTime, setRecordingStartTime] = useState(null);
  const [generatedHashtags, setGeneratedHashtags] = useState([]);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [stepByStepProcessed, setStepByStepProcessed] = useState(false); // Prevent duplicate AI generation
  
  // Content View States
  const [contentView, setContentView] = useState('original'); // 'ai' or 'original'
  const [originalCaption, setOriginalCaption] = useState(transcript || '');
  const [aiCaption, setAiCaption] = useState('');
  
  // Manual Description States
  const [manualDescription, setManualDescription] = useState('');
  const [isGeneratingFromText, setIsGeneratingFromText] = useState(false);
  
  // UI State
  const [isManualDescriptionExpanded, setIsManualDescriptionExpanded] = useState(false);
  const [isCapturingMultiplePhotos, setIsCapturingMultiplePhotos] = useState(false);
  const [showMultiPhotoModal, setShowMultiPhotoModal] = useState(false);
  const [currentPhotoCount, setCurrentPhotoCount] = useState(0);
  const [shouldAutoTriggerStepByStep, setShouldAutoTriggerStepByStep] = useState(false);
  const scrollViewRef = useRef(null);

  // Initialize original caption when transcript changes
  useEffect(() => {
    if (transcript) {
      setOriginalCaption(transcript);
      setCaption(transcript);
    }
  }, [transcript]);
  
  // Auto-show description overlay immediately when coming from camera
  useEffect(() => {
    console.log('🔍 Checking auto-show conditions:', {
      mediaItemsLength: mediaItems.length,
      type: type,
      showDescriptionMethodOverlay: showDescriptionMethodOverlay
    });
    
    if (mediaItems.length > 0 && (type === 'photo' || type === 'photos') && !showDescriptionMethodOverlay) {
      // Show description overlay for both single and multiple photos
      console.log('📸 Showing description overlay for', mediaItems.length, 'photos');
      if (!overlayAlreadyShown) {
        setShowDescriptionMethodOverlay(true);
        setOverlayAlreadyShown(true);
      }
    }
  }, [mediaItems, type, showDescriptionMethodOverlay]);
  
  // Removed backup trigger to prevent duplicate overlays
  
  // Media Descriptions States
  const [mediaDescriptions, setMediaDescriptions] = useState([]);
  const [isGeneratingDescriptions, setIsGeneratingDescriptions] = useState(false);
  const [isProcessingAllAI, setIsProcessingAllAI] = useState(false);
  
  // Media Viewer States
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [showMediaViewer, setShowMediaViewer] = useState(false);
  
  // AI Comment Generation State
  const [isGeneratingComments, setIsGeneratingComments] = useState(false);
  const [generatedComments, setGeneratedComments] = useState([]);
  
  // Enhanced AI Description System
  const [accumulatedVoiceInputs, setAccumulatedVoiceInputs] = useState([]);
  const [allContextualData, setAllContextualData] = useState({
    photoDescriptions: [],
    voiceInputs: [],
    manualText: ''
  });
  
  // User Intent State - only generate AI when explicitly requested
  const [userRequestedAI, setUserRequestedAI] = useState(false);
  
  // Description Method Selection Overlay States
  const [showDescriptionMethodOverlay, setShowDescriptionMethodOverlay] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [descriptionText, setDescriptionText] = useState('');
  const [isRecordingFromOverlay, setIsRecordingFromOverlay] = useState(false);
  const [overlayRenderTrigger, setOverlayRenderTrigger] = useState(0);
  const [overlayAlreadyShown, setOverlayAlreadyShown] = useState(false);
  
  // Step-by-Step AI Progress Overlay States
  const [showStepByStepOverlay, setShowStepByStepOverlay] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [aiSteps, setAiSteps] = useState([]);
  const [currentStepDescription, setCurrentStepDescription] = useState('');
  const [pendingStepByStepProcessing, setPendingStepByStepProcessing] = useState(false);
  
  // Review Overlay States - shows descriptions and voice input before AI generation
  const [showReviewOverlay, setShowReviewOverlay] = useState(false);
  const [reviewData, setReviewData] = useState({
    voiceInput: '',
    photoDescriptions: [],
    isGeneratingAI: false
  });
  
  // Back Navigation Confirmation States
  const [showBackConfirmation, setShowBackConfirmation] = useState(false);

  // Check if there's unsaved content
  const hasUnsavedContent = () => {
    return (
      mediaItems.length > 0 || 
      caption.trim() !== '' || 
      originalCaption.trim() !== '' ||
      aiCaption.trim() !== '' ||
      manualDescription.trim() !== ''
    );
  };

  // Handle back navigation with confirmation
  const handleBackNavigation = () => {
    if (hasUnsavedContent()) {
      setShowBackConfirmation(true);
    } else {
      navigation.goBack();
    }
  };

  // Handle saving as draft
  const handleSaveAsDraft = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        Alert.alert('Error', 'Please log in to save drafts');
        return;
      }

      const draftData = {
        userId: user.uid,
        type: 'draft',
        mediaItems: mediaItems.map(item => ({
          uri: item.uri,
          type: item.type,
          width: item.width,
          height: item.height
        })),
        caption: caption || originalCaption || aiCaption,
        manualDescription: manualDescription,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await addDoc(collection(db, 'drafts'), draftData);
      
      Toast.show({
        type: 'success',
        text1: '💾 Draft Saved!',
        text2: 'Your post has been saved as a draft',
        position: 'bottom',
        visibilityTime: 2000,
      });

      setShowBackConfirmation(false);
      navigation.goBack();
    } catch (error) {
      console.error('Error saving draft:', error);
      Alert.alert('Error', 'Failed to save draft');
    }
  };

  // Handle discarding changes
  const handleDiscardChanges = () => {
    setShowBackConfirmation(false);
    navigation.goBack();
  };

  const togglePlatform = (platform) => {
    setSelectedPlatforms(prev => ({
      ...prev,
      [platform]: !prev[platform]
    }));
  };

  // Reset AI content when mediaItems change (but don't auto-generate descriptions)
  // Separate ref to track if we just completed step-by-step processing
  const justCompletedStepByStepRef = useRef(false);

  useEffect(() => {
    if (mediaItems.length > 0) {
      // Debug: Log all the conditions to understand what's happening
      console.log('🔍 useEffect conditions:', {
        stepByStepProcessed,
        showStepByStepOverlay,
        pendingStepByStepProcessing,
        mediaItemsLength: mediaItems.length,
        justCompletedStepByStep: justCompletedStepByStepRef.current,
        shouldAutoTriggerStepByStep
      });
      
      // Don't reset if step-by-step processing is active/completed OR if we should auto-trigger
      if (stepByStepProcessed || showStepByStepOverlay || pendingStepByStepProcessing || justCompletedStepByStepRef.current || shouldAutoTriggerStepByStep) {
        console.log('🚫 Skipping AI content reset - step-by-step processing active/completed or auto-trigger pending');
        
        // Reset the ref flag after preventing the reset (but keep other conditions)
        if (justCompletedStepByStepRef.current) {
          setTimeout(() => {
            justCompletedStepByStepRef.current = false;
            console.log('🔄 Reset protection period ended');
          }, 10000); // Much longer timeout to ensure stability
        }
        
        // Only reset the flag if it was due to completion (not active processing)
        if (stepByStepProcessed && !showStepByStepOverlay && !pendingStepByStepProcessing) {
          setTimeout(() => {
            setStepByStepProcessed(false);
          }, 2000);
        }
        return;
      }
      
      // Reset AI content when new media is added - user must manually trigger AI generation
      setShowAiContent(false);
      setGeneratedContent(null);
      setAiCaption('');
      setGeneratedHashtags([]);
      setAiSuggestions(null);
      
      // Ensure no loading states are active
      setIsGeneratingContent(false);
      setIsGeneratingDescriptions(false);
      setIsProcessingAllAI(false);
      
      // Reset user AI request flag for new photos
      setUserRequestedAI(false);
      
      console.log('🔄 New media added - AI content reset, waiting for user to trigger generation');
    }
  }, [mediaItems, stepByStepProcessed, showStepByStepOverlay, pendingStepByStepProcessing, shouldAutoTriggerStepByStep]);

  // Auto-generate descriptions for each photo as soon as it's added
  useEffect(() => {
    const autoGenerateDescriptions = async () => {
      // Only generate if we have media items and no descriptions yet
      if (mediaItems.length === 0) return;
      
      // Check if any photos need descriptions
      const needsDescriptions = mediaItems.some((item, index) => {
        return item.type === 'photo' && !mediaDescriptions[index];
      });
      
      if (!needsDescriptions) return;
      
      console.log('🤖 Auto-generating descriptions for new photos...');
      
      // Use existing generateMediaDescriptions with forceGeneration=true to bypass userRequestedAI check
      await generateMediaDescriptions(true);
    };
    
    // Don't auto-generate if step-by-step processing is happening
    if (!showStepByStepOverlay && !stepByStepProcessed && !pendingStepByStepProcessing) {
      autoGenerateDescriptions();
    }
  }, [mediaItems]); // Only depend on mediaItems changes

  // Auto-trigger logic removed - camera flow now goes directly to step-by-step processing

  // Note: Auto-generation removed - AI content now only generates when user explicitly requests it

  const generateMediaDescriptions = async (forceGeneration = false) => {
    if (mediaItems.length === 0) {
      setMediaDescriptions([]);
      return;
    }

    // Only generate if user explicitly requested AI or force is true
    if (!userRequestedAI && !forceGeneration) {
      console.log('🚫 Skipping photo description generation - user has not requested AI');
      return;
    }

    try {
      setIsGeneratingDescriptions(true);
      setIsProcessingAllAI(true);
      console.log(`🎯 Generating descriptions for ${mediaItems.length} media items...`);
      console.log('📋 Media items to process:', mediaItems.map(item => ({ type: item.type, uri: item.uri?.substring(0, 50) + '...' })));
      
      // Test media description service connection first
      const serviceOk = await mediaDescriptionService.testConnection();
      if (!serviceOk) {
        console.error('❌ Media description service connection failed');
        throw new Error('Media description service not available');
      }
      
      const descriptions = await mediaDescriptionService.generateMediaDescriptions(mediaItems);
      console.log('✅ Generated descriptions:', descriptions);
      setMediaDescriptions(descriptions);
      
      // Update contextual data with photo descriptions
      setAllContextualData(prev => ({
        ...prev,
        photoDescriptions: descriptions
      }));
      
      console.log('✅ Media descriptions generated successfully');
    } catch (error) {
      console.error('❌ Failed to generate media descriptions:', error.message);
      console.error('❌ Full error:', error);
      
      // Check if it's a quota error - disable AI features gracefully
      if (error.message.includes('quota') || error.message.includes('429')) {
        console.log('� API quota exceeded - disabling AI features temporarily');
        setMediaDescriptions(['⚠️ AI temporarily unavailable due to quota limits']);
        // Disable automatic AI content generation when quota exceeded
        return;
      } else {
        // Create fallback descriptions for other errors
        const fallbackDescriptions = mediaItems.map((item, index) => {
          const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return item.type === 'video' 
            ? `Video ${index + 1} captured at ${timestamp}`
            : `Photo ${index + 1} captured at ${timestamp}`;
        });
        
        console.log('🔄 Using fallback descriptions:', fallbackDescriptions);
        setMediaDescriptions(fallbackDescriptions);
      }
    } finally {
      setIsGeneratingDescriptions(false);
      setIsProcessingAllAI(false);
    }
  };

  const removeMediaItem = (index) => {
    setMediaItems(prevItems => prevItems.filter((_, i) => i !== index));
    setMediaDescriptions(prevDescriptions => prevDescriptions.filter((_, i) => i !== index));
  };

  const openMediaViewer = (mediaItem, index) => {
    setSelectedMedia({ ...mediaItem, index });
    setShowMediaViewer(true);
  };

  const closeMediaViewer = () => {
    setSelectedMedia(null);
    setShowMediaViewer(false);
  };

  // Enhanced AI Voice Description
  const startVoiceDescription = async () => {
    try {
      console.log('🎤 Starting AI-powered voice description...');
      
      const success = await speechToTextService.startRecording(
        // Status update callback
        (status) => {
          setRecordingDuration(status.duration || 0);
        },
        // No auto-stop callback to prevent infinite loops
        null,
        // No silence timeout to prevent issues
        0
      );

      if (success) {
        setIsRecording(true);
        Toast.show({
          type: 'info',
          text1: '🎤 Recording... (Auto-stops when you finish)',
          text2: 'Speak naturally, it will stop when you pause',
          position: 'top',
        });
      }
    } catch (error) {
      console.error('Failed to start AI voice recording:', error);
      
      // Use toast instead of alert to prevent navigation
      Toast.show({
        type: 'error',
        text1: '🎤 Microphone access failed',
        text2: 'Please check permissions and try again',
        position: 'top',
      });
    }
  };

  const stopVoiceDescription = async () => {
    if (!isRecording) {
      console.log('⚠️ No active recording to stop');
      return;
    }

    try {
      setIsRecording(false);
      setIsTranscribing(true);

      console.log('🛑 Stopping voice recording and generating AI content...');

      // Get transcription
      const audioUri = await speechToTextService.stopRecording();
      
      if (!audioUri) {
        throw new Error('No audio recorded');
      }

      // Use Gemini AI for speech transcription with timeout
      console.log('🤖 Using Gemini AI for speech transcription...');
      
      const transcriptionPromise = geminiSpeechService.transcribeAudio(audioUri);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Transcription timeout after 30 seconds')), 30000)
      );
      
      const transcript = await Promise.race([transcriptionPromise, timeoutPromise]);
      setVoiceTranscript(transcript);

      console.log('📝 Voice transcript:', transcript);

      // Handle transcription result
      if (transcript && !transcript.includes('Audio recorded') && !transcript.includes('🎤')) {
        // Add to accumulated voice inputs
        setAccumulatedVoiceInputs(prev => {
          const newInputs = [...prev, transcript];
          console.log('🎤 Updated accumulated voice inputs:', newInputs);
          return newInputs;
        });
        
        // Update contextual data
        setAllContextualData(prev => ({
          ...prev,
          voiceInputs: [...prev.voiceInputs, transcript]
        }));
        
        // Also put in manual text box for potential editing
        setManualDescription(prev => prev ? `${prev}\n\n${transcript}` : transcript);
        setIsTranscribing(false);
        
        Toast.show({
          type: 'success',
          text1: '🎤 Voice input added!',
          text2: `"${transcript.slice(0, 30)}${transcript.length > 30 ? '...' : ''}"`,
          position: 'bottom',
        });
        
        // Auto-trigger step-by-step processing if recording was from description overlay
        if (isRecordingFromOverlay) {
          console.log('🎤 Voice input recorded from overlay - starting step-by-step processing with transcript');
          console.log('🎤 Transcript to process:', transcript);
          
          // Close overlay and start step-by-step processing immediately with the transcript
          setTimeout(() => {
            setShowDescriptionMethodOverlay(false);
            // Start step-by-step processing with the voice transcript
            processPhotosStepByStepWithVoice(transcript);
          }, 1000); // Short delay to show success toast
          return;
        }
        
        // Only auto-trigger AI generation if NOT coming from camera with multiple photos
        // If coming from camera, trigger step-by-step processing now that voice is done
        if (!shouldAutoTriggerStepByStep) {
          setTimeout(() => {
            console.log('🚀 Auto-regenerating AI content with new voice input:', transcript);
            generateComprehensiveAIContent(true, transcript); // Bypass step-by-step check, pass voice data
          }, 1500); // Small delay to show the success toast
        } else {
          console.log('🎤 Voice input added - triggering step-by-step processing now');
          setTimeout(() => {
            initializeStepByStepProcessing();
            setShouldAutoTriggerStepByStep(false); // Reset flag after triggering
          }, 2000); // Small delay to show the success toast first
        }
      } else {
        console.log('🎤 Voice recording complete - using fallback placeholder');
        setIsTranscribing(false);
        setManualDescription('');
        
        Toast.show({
          type: 'info',
          text1: '🎤 Audio recorded',
          text2: 'Type your description in the text box below',
          position: 'bottom',
        });
        
        // Don't auto-trigger if recording was from description overlay
        if (isRecordingFromOverlay) {
          console.log('🎤 No transcript from overlay recording - staying in overlay');
          Toast.show({
            type: 'info',
            text1: '🎤 Voice recorded',
            text2: 'No clear speech detected, try recording again',
            position: 'bottom',
          });
          return;
        }
        
        // Only start step-by-step processing if NOT coming from camera with multiple photos
        if (!shouldAutoTriggerStepByStep) {
          setTimeout(() => {
            console.log('🚀 Starting step-by-step processing without voice input');
            initializeStepByStepProcessing();
          }, 1000);
        } else {
          console.log('🎤 No transcript - waiting for user action in camera flow');
        }
      }

    } catch (error) {
      console.error('Error in AI voice processing:', error);
      
      // Don't show alert immediately, try to recover gracefully
      setIsTranscribing(false);
      
      // Don't auto-trigger if recording was from description overlay
      if (isRecordingFromOverlay) {
        console.log('🔄 Voice processing failed from overlay - staying in overlay');
        Toast.show({
          type: 'info',
          text1: '🎤 Voice processing failed',
          text2: 'Try recording again or use text input',
          position: 'bottom',
        });
        return;
      }
      
      // Only start step-by-step processing if NOT coming from camera with multiple photos
      if (!shouldAutoTriggerStepByStep) {
        console.log('🔄 Voice processing failed, continuing with step-by-step anyway');
        setTimeout(() => {
          initializeStepByStepProcessing();
        }, 500);
      } else {
        console.log('🔄 Voice processing failed in camera flow - waiting for user action');
      }
      
      // Show helpful toast  
      Toast.show({
        type: 'info',
        text1: '🎤 Voice processing skipped',
        text2: 'Continuing with photo analysis...',
        position: 'bottom',
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  // Handle using the voice transcript
  const handleUseTranscript = async () => {
    if (!originalCaption.trim()) {
      Alert.alert('Empty Text', 'Please type what you said first, then tap enhance with AI.');
      return;
    }

    try {
      console.log('✅ Using original caption for AI generation...');
      
      // User explicitly requested AI generation
      setUserRequestedAI(true);
      
      // Generate AI content with the user's typed text
      await generateAiContent(originalCaption);
      
      // Switch to AI view to show the enhanced content
      setContentView('ai');

    } catch (error) {
      console.error('Error using transcript:', error);
      Alert.alert('Error', 'Failed to process text. Please try again.');
    }
  };

  // Handle enhancing from manual text input
  const handleEnhanceFromText = async () => {
    if (!manualDescription.trim()) {
      Alert.alert('Empty Text', 'Please type a description first.');
      return;
    }

    try {
      setIsGeneratingFromText(true);
      console.log('✅ Generating AI content from manual text input...');
      
      // User explicitly requested AI generation
      setUserRequestedAI(true);
      
      // Generate AI content with the user's manual text
      await generateAiContent(manualDescription);
      
      // Switch to AI view to show the enhanced content
      setContentView('ai');
      
      // Clear the manual input after successful generation
      setManualDescription('');

    } catch (error) {
      console.error('Error enhancing from text:', error);
      Alert.alert('Error', 'Failed to enhance text. Please try again.');
    } finally {
      setIsGeneratingFromText(false);
    }
  };

  // Generate AI-enhanced content
  const generateAiContent = async (voiceInput) => {
    try {
      setIsGeneratingContent(true);

      console.log(`� Generating AI content with voice input: "${voiceInput}"`);
      console.log(`📋 Available media items: ${mediaItems.length}`);

      if (mediaItems.length === 0) {
        console.warn('⚠️ No media items available, using voice input only');
        setCaption(voiceInput);
        setGeneratedHashtags(['voice', 'memo', 'thoughts']);
        return;
      }

      // Generate photo descriptions first if they don't exist
      if (!mediaDescriptions || mediaDescriptions.length !== mediaItems.length) {
        console.log('📸 Photo descriptions missing, generating now...');
        await generateMediaDescriptions(true); // Force generation when user explicitly requests AI
      }

      // Use the first media item for AI generation (matching HTML approach)
      const firstMediaItem = mediaItems[0];
      console.log('🎯 Using first media item for AI generation:', { 
        type: firstMediaItem.type, 
        uri: firstMediaItem.uri?.substring(0, 50) + '...' 
      });

      // Generate comprehensive post data using the new service
      const aiContent = await mediaDescriptionService.generateFullPostData(
        firstMediaItem.uri, 
        voiceInput
      );

      console.log('✅ AI content generated:', aiContent);

      if (aiContent) {
        setGeneratedContent(aiContent);
        setAiCaption(aiContent.description);
        setCaption(aiContent.description);
        setGeneratedHashtags(aiContent.hashtags);
        setAiSuggestions(aiContent);
        setShowAiContent(true);
        setContentView('ai');

        Toast.show({
          type: 'success',
          text1: '🤖 AI Enhancement Complete!',
          text2: 'Your content has been enhanced with AI',
          position: 'bottom',
        });
      } else {
        throw new Error('No AI content generated');
      }

    } catch (error) {
      console.error('❌ AI content generation failed:', error);
      
      // Use smart fallback content from the new service with user input
      const fallbackContent = mediaItems.length > 0 
        ? mediaDescriptionService.getSmartFallbackDescription(mediaItems[0], voiceInput)
        : { title: 'My Story', description: voiceInput + ' 📱✨', hashtags: ['story', 'personal', 'voice'] };
      
      console.log('🔄 Using personalized fallback with user input:', { voiceInput, fallbackContent });
      
      setGeneratedContent(fallbackContent);
      setAiCaption(fallbackContent.description);
      setCaption(fallbackContent.description);
      setGeneratedHashtags(fallbackContent.hashtags);
      setAiSuggestions(fallbackContent);
      setContentView('ai');
      setShowAiContent(true);
      
      Toast.show({
        type: 'info',
        text1: '✨ Smart Content Generated',
        text2: 'Using your words with intelligent formatting',
        position: 'bottom',
      });
    } finally {
      setIsGeneratingContent(false);
    }
  };

  // Enhance existing content with AI
  const enhanceWithAi = async () => {
    if (!caption.trim()) {
      Alert.alert('No Content', 'Please add some text to enhance');
      return;
    }

    if (!aiService.isAvailable()) {
      Alert.alert('AI Unavailable', 'AI enhancement is not available right now');
      return;
    }

    try {
      setIsGeneratingContent(true);

      // Test connection first
      console.log('🧪 Testing AI connection for enhancement...');
      const connectionOk = await aiService.testConnection();
      
      if (!connectionOk) {
        throw new Error('AI service connection failed');
      }

      // Format mediaItems for AI service
      const formattedMediaItems = mediaItems.map(item => ({
        uri: item.uri,
        type: item.type,
        mimeType: item.type === 'photo' ? 'image/jpeg' : 'video/mp4'
      }));

      console.log(`🚀 Enhancing content with AI using ${formattedMediaItems.length} media items...`);
      const aiContent = await aiService.enhanceExistingContent(caption, formattedMediaItems);
      
      setGeneratedContent(aiContent);
      setGeneratedHashtags(aiContent.hashtags);
      setAiSuggestions(aiContent);
      setShowAiContent(true);

      Toast.show({
        type: 'success',
        text1: '🤖 AI Enhancement Complete!',
        text2: 'Your content has been enhanced',
        position: 'bottom',
      });

    } catch (error) {
      console.error('❌ Failed to enhance content:', error);
      
      // Generate smart fallback
      const fallbackContent = aiService.generateFallbackContent(caption, media ? [media] : []);
      
      setGeneratedContent(fallbackContent);
      setGeneratedHashtags(fallbackContent.hashtags);
      setAiSuggestions(fallbackContent);
      setShowAiContent(true);
      
      Toast.show({
        type: 'info',
        text1: '✨ Smart Enhancement Applied',
        text2: 'AI unavailable - used intelligent processing',
        position: 'bottom',
      });
    } finally {
      setIsGeneratingContent(false);
    }
  };

  // Generate AI content from media (called manually by user)
  const generateAiContentFromMedia = async (newMediaItems) => {
    try {
      if (!newMediaItems || newMediaItems.length === 0) {
        return;
      }

      // Generate photo descriptions first if they don't exist
      if (!mediaDescriptions || mediaDescriptions.length !== newMediaItems.length) {
        console.log('📸 Photo descriptions missing, generating now...');
        await generateMediaDescriptions(true); // Force generation when user explicitly requests AI
      }

      // Check if AI is temporarily unavailable due to quota
      if (mediaDescriptions.length > 0 && mediaDescriptions[0].includes('quota limits')) {
        console.log('🚫 Skipping AI content generation - quota exceeded');
        return;
      }

      console.log(`🤖 Generating AI content for ${newMediaItems.length} media items with descriptions...`);
      setIsGeneratingContent(true);
      setIsProcessingAllAI(true);

      // Create enhanced prompt using ALL media descriptions
      let enhancedPrompt;
      const mediaCount = newMediaItems.length;
      const mediaTypes = newMediaItems.map(item => item.type);
      
      // Check if we have valid AI descriptions (not just fallback timestamp descriptions)
      const hasValidDescriptions = mediaDescriptions.length > 0 && 
        !mediaDescriptions.some(desc => desc.includes('captured at') || desc.includes('quota limits'));
      
      if (hasValidDescriptions && mediaDescriptions.length === mediaCount) {
        // Multiple media items - create comprehensive prompt
        if (mediaCount > 1) {
          const descriptionsText = mediaDescriptions.map((desc, idx) => `Photo ${idx + 1}: ${desc}`).join('. ');
          enhancedPrompt = `Create a social media post about these ${mediaCount} photos: ${descriptionsText}`;
        } else {
          const descriptionsText = mediaDescriptions[0];
          enhancedPrompt = `Create a social media post about this photo: ${descriptionsText}`;
        }
        console.log('📝 Using enhanced prompt with AI descriptions for all media:', enhancedPrompt);
      } else {
        // Fallback prompt when no descriptions available
        if (mediaCount > 1) {
          enhancedPrompt = `Create a social media post about these ${mediaCount} photos`;
        } else {
          enhancedPrompt = `Create a social media post about this photo`;
        }
        console.log('📝 Using direct analysis prompt - processing all media');
      }
      
      // Use the first media item's URI for the API call, with the enhanced prompt as context
      const primaryMediaItem = newMediaItems[0];
      const aiContent = await mediaDescriptionService.generateFullPostDataWithContext(
        primaryMediaItem.uri, 
        enhancedPrompt,
        mediaDescriptions
      );

      if (aiContent) {
        setGeneratedContent(aiContent);
        setAiCaption(aiContent.description);
        setCaption(aiContent.description);
        setGeneratedHashtags(aiContent.hashtags);
        setAiSuggestions(aiContent);
        setShowAiContent(true);
        setContentView('ai');

        // Auto-scroll to AI content after a short delay
        setTimeout(() => {
          scrollViewRef.current?.scrollTo({ y: 600, animated: true });
        }, 800);

        Toast.show({
          type: 'success',
          text1: '🤖 AI Content Generated!',
          text2: 'Your post has been automatically enhanced',
          position: 'bottom',
        });
      }

    } catch (error) {
      console.error('❌ Auto AI generation failed:', error);
      // Don't show error toast for auto-generation to avoid interrupting user flow
    } finally {
      setIsGeneratingContent(false);
      setIsProcessingAllAI(false);
    }
  };

  const addMediaFromLibrary = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets?.length > 0) {
        // Add new media to existing mediaItems
        const newMediaItems = result.assets.map(asset => ({
          ...asset,
          type: asset.type === 'video' ? 'video' : 'photo'
        }));
        
        console.log('📸 Adding media from library:', newMediaItems.length, 'items');
        console.log('📸 New media types:', newMediaItems.map(item => item.type));
        setMediaItems(prevItems => {
          const updatedItems = [...prevItems, ...newMediaItems];
          console.log('📸 Total media items now:', updatedItems.length);
          return updatedItems;
        });
        
        // Individual descriptions will be generated by useEffect
        // Full AI content will be generated after descriptions are ready
      }
    } catch (error) {
      console.error('Error selecting media from library:', error);
      Alert.alert('Error', 'Failed to access media library');
    }
  };

  // Hold-to-talk voice button handlers
  const handleVoiceButtonPressIn = () => {
    if (!isTranscribing && !isGeneratingContent) {
      startVoiceDescription().catch(error => {
        console.error('Voice recording error:', error);
      });
    }
  };

  const handleVoiceButtonPressOut = () => {
    if (isRecording) {
      stopVoiceDescription().catch(error => {
        console.error('Voice recording error:', error);
      });
    }
  };

  // Multi-photo modal handlers
  const handleTakeAnotherPhoto = () => {
    console.log('📸 User chose to take another photo');
    setShowMultiPhotoModal(false);
    handleTakePhoto(); // Recursively call to take another photo
  };

  const handleContinueWithPost = () => {
    console.log('📝 User chose to continue with current photos - same as Done button behavior');
    setShowMultiPhotoModal(false);
    setIsCapturingMultiplePhotos(false);
    
    // Behave exactly like the Done button from CameraScreen:
    // Close modal and show description overlay immediately
    console.log('🏁 [TRIGGER-2] Continuing with', mediaItems.length, 'photos - showing description options');
    if (!overlayAlreadyShown) {
      setShowDescriptionMethodOverlay(true);
      setOverlayAlreadyShown(true);
    } else {
      console.log('⚠️ Overlay already shown, skipping duplicate trigger');
    }
  };

  // Initialize step-by-step processing immediately for voice input
  const initializeStepByStepProcessingWithVoice = async (voiceTranscript = null) => {
    try {
      console.log('🚀 Initializing step-by-step processing with voice input:', voiceTranscript);
      
      // Prepare steps for each photo + voice input
      const steps = [];
      mediaItems.forEach((media, index) => {
        steps.push({
          title: `Photo ${index + 1} - Generating Description`,
          description: `Creating AI description for photo ${index + 1}`,
          completed: false
        });
      });
      
      // Add voice input step with actual transcript or placeholder
      if (voiceTranscript) {
        steps.push({
          title: 'Voice Input',
          description: voiceTranscript.length > 60 ? voiceTranscript.slice(0, 60) + '...' : voiceTranscript,
          fullDescription: voiceTranscript,
          completed: true,
          isVoice: true
        });
      } else {
        steps.push({
          title: 'Voice Input',
          description: 'Processing your voice description...',
          completed: false,
          isVoice: true
        });
      }
      
      // Add final step
      steps.push({
        title: 'Generating AI Post Automatically',
        description: 'Creating comprehensive post content',
        completed: false
      });
      
      // Set the steps and show overlay
      setAiSteps(steps);
      setCurrentStep(0);
      setCurrentStepDescription(`Processing photo 1 of ${mediaItems.length}...`);
      setShowStepByStepOverlay(true);
      
      // Start processing photos
      await processPhotosStepByStepWithVoice(voiceTranscript);
      
    } catch (error) {
      console.error('❌ Failed to initialize immediate step-by-step processing:', error);
      Alert.alert('Error', 'Failed to start AI processing');
      setShowStepByStepOverlay(false);
    }
  };

  // Initialize step-by-step processing for multiple photos
  const initializeStepByStepProcessing = async () => {
    try {
      console.log('🚀 Initializing step-by-step AI processing for', mediaItems.length, 'photos');
      
      // Prepare steps for each photo
      const steps = [];
      mediaItems.forEach((media, index) => {
        steps.push({
          title: `Photo ${index + 1} - Generating Description`,
          description: `Creating AI description for photo ${index + 1}`,
          completed: false
        });
      });
      
      // Always add voice input step to match green button flow
      const hasVoiceInput = accumulatedVoiceInputs.length > 0;
      if (hasVoiceInput) {
        const voiceText = accumulatedVoiceInputs.join(' ');
        steps.push({
          title: 'Voice Input',
          description: voiceText.length > 60 ? voiceText.slice(0, 60) + '...' : voiceText,
          fullDescription: voiceText,
          completed: true, // Mark as completed since voice was already recorded
          isVoice: true
        });
      } else {
        // Add placeholder voice input step like green button flow
        steps.push({
          title: 'Voice Input',
          description: 'Processing your voice description...',
          completed: false,
          isVoice: true
        });
      }
      
      // Add final step
      steps.push({
        title: 'Generating AI Post Automatically',
        description: 'Creating comprehensive post content',
        completed: false
      });
      
      // Set the steps and show overlay
      setAiSteps(steps);
      setCurrentStep(0);
      setCurrentStepDescription(`Analyzing photo 1 of ${mediaItems.length}...`);
      setShowStepByStepOverlay(true);
      
      // Start processing each photo
      await processPhotosStepByStep();
      
    } catch (error) {
      console.error('❌ Failed to initialize step-by-step processing:', error);
      Alert.alert('Error', 'Failed to start AI processing');
      setShowStepByStepOverlay(false);
    }
  };

  // Process photos step by step with voice input
  const processPhotosStepByStepWithVoice = async (voiceTranscript = null) => {
    try {
      console.log('🚀 Starting step-by-step processing with voice transcript:', voiceTranscript);
      
      // Initialize steps for photos + voice + AI generation
      const steps = [];
      mediaItems.forEach((media, index) => {
        steps.push({
          title: `Photo ${index + 1}`,
          description: `Analyzing photo ${index + 1}...`,
          completed: false
        });
      });
      
      // Add voice step
      steps.push({
        title: 'Voice Input',
        description: voiceTranscript ? 'Processing voice description...' : 'Waiting for voice input...',
        completed: false
      });
      
      // Add AI generation step
      steps.push({
        title: 'AI Generation',
        description: 'Generating AI post...',
        completed: false
      });
      
      // Set up the overlay
      setAiSteps(steps);
      setCurrentStep(0);
      setCurrentStepDescription(`Analyzing photo 1 of ${mediaItems.length}...`);
      setShowStepByStepOverlay(true);
      
      const descriptions = [];
      
      // Process each photo
      for (let i = 0; i < mediaItems.length; i++) {
        const media = mediaItems[i];
        console.log(`🔍 Processing photo ${i + 1}/${mediaItems.length}`);
        
        // Update current step
        setCurrentStep(i);
        setCurrentStepDescription(`Analyzing photo ${i + 1} of ${mediaItems.length}...`);
        
        // Generate description for this photo
        const description = await mediaDescriptionService.generateMediaDescription(media);
        descriptions.push(description);
        
        // Update step to show completion
        setAiSteps(prev => prev.map((step, index) => 
          index === i ? { ...step, completed: true, description: description.slice(0, 60) + '...' } : step
        ));
        
        // Small delay to show the completion
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Move to voice step and complete it if we have transcript
      const voiceStepIndex = mediaItems.length;
      setCurrentStep(voiceStepIndex);
      
      if (voiceTranscript) {
        setCurrentStepDescription('Processing voice description...');
        
        // Update voice step to show the actual transcript
        setAiSteps(prev => prev.map((step, index) => 
          index === voiceStepIndex ? { ...step, completed: true, description: voiceTranscript } : step
        ));
        
        // Small delay to show the voice step
        await new Promise(resolve => setTimeout(resolve, 1200));
        
        // Complete the final step with AI generation
        await completeStepByStepProcessing(voiceTranscript, descriptions);
      } else {
        setCurrentStepDescription('Waiting for voice description...');
        // Store descriptions for when voice completes
        window.tempPhotoDescriptions = descriptions;
      }
      
    } catch (error) {
      console.error('❌ Failed to process photos during voice recording:', error);
    }
  };

  // Process photos step by step with visual progress
  const processPhotosStepByStep = async () => {
    try {
      const descriptions = [];
      
      for (let i = 0; i < mediaItems.length; i++) {
        const media = mediaItems[i];
        console.log(`🔍 Processing photo ${i + 1}/${mediaItems.length}`);
        
        // Update current step
        setCurrentStep(i);
        setCurrentStepDescription(`Analyzing photo ${i + 1} of ${mediaItems.length}...`);
        
        // Generate description for this photo
        const description = await mediaDescriptionService.generateMediaDescription(media);
        descriptions.push(description);
        
        // Update step to show completion
        setAiSteps(prev => prev.map((step, index) => 
          index === i ? { ...step, completed: true, description: description.slice(0, 60) + '...' } : step
        ));
        
        // Small delay to show the completion
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Always show voice input step (now always included in steps)
      const hasVoiceInput = accumulatedVoiceInputs.length > 0;
      const voiceStepIndex = mediaItems.length;
      const finalStepIndex = mediaItems.length + 1;
      
      // Show voice input step
      setCurrentStep(voiceStepIndex);
      
      if (hasVoiceInput) {
        setCurrentStepDescription('Processing voice input...');
        
        // Mark voice step as completed and show what user said
        const voiceText = accumulatedVoiceInputs.join(' ');
        setAiSteps(prev => prev.map((step, index) => 
          index === voiceStepIndex ? { ...step, completed: true, description: voiceText } : step
        ));
      } else {
        setCurrentStepDescription('No voice input provided');
        
        // Mark voice step as completed with "No voice input" message
        setAiSteps(prev => prev.map((step, index) => 
          index === voiceStepIndex ? { ...step, completed: true, description: 'No voice input provided' } : step
        ));
      }
      
      // Small delay to show the voice input step
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Final step - generate comprehensive content
      setCurrentStep(finalStepIndex);
      setCurrentStepDescription('Generating AI post automatically...');
      
      // Generate AI content using all descriptions + voice input
      const allDescriptionsText = descriptions.join('\n\n');
      const voiceContext = hasVoiceInput ? accumulatedVoiceInputs.join('\n\n') : '';
      
      let enhancedPrompt;
      if (hasVoiceInput) {
        enhancedPrompt = `Create a social media post using the user's voice description "${voiceContext}" and these photo descriptions: ${allDescriptionsText}`;
        console.log('🎤📸 Using voice input + photo descriptions for AI generation');
      } else {
        enhancedPrompt = `Create a social media post using these photo descriptions: ${allDescriptionsText}`;
        console.log('📸 Using photo descriptions only for AI generation');
      }
      
      let aiContent;
      try {
        aiContent = await mediaDescriptionService.generateFullPostDataWithContext(
          mediaItems[0].uri,
          enhancedPrompt,
          descriptions
        );
        console.log('✅ AI generation successful');
      } catch (aiError) {
        console.log('⚠️ AI generation failed, using smart fallback:', aiError.message);
        // Use smart fallback that considers the context
        aiContent = {
          title: mediaItems.length > 1 ? 'Photo Collection' : 'My Photo',
          description: hasVoiceInput 
            ? `${voiceContext} 📸✨` 
            : (mediaItems.length > 1 
                ? 'Sharing some awesome moments from today! 📸✨' 
                : 'Captured a great moment! 📷✨'),
          hashtags: hasVoiceInput 
            ? ['photo', 'moment', 'life', 'voice'] 
            : ['photo', 'moment', 'life', 'capture']
        };
      }
      
      // Update final step
      setAiSteps(prev => prev.map((step, index) => 
        index === finalStepIndex ? { ...step, completed: true } : step
      ));
      
      // Apply the generated content and make it immediately visible
      setMediaDescriptions(descriptions);
      setAiCaption(aiContent.description || '');
      setGeneratedHashtags(aiContent.hashtags || []);
      setContentView('ai');
      setShowAiContent(true); // Show the AI content automatically
      setUserRequestedAI(true);
      setStepByStepProcessed(true); // Mark as processed to prevent further resets
      
      // Also update the original caption to show AI content immediately
      setCaption(aiContent.description || '');
      
      // Wait before closing overlay to ensure AI content is fully applied
      setCurrentStepDescription('✅ AI Post Generated Successfully!');
      console.log('✅ AI content generated, showing on main screen immediately');
      
      setTimeout(() => {
        setShowStepByStepOverlay(false);
        console.log('✅ Step-by-step processing complete - AI content visible on main screen');
        
        // Scroll to AI content section to make it immediately visible
        setTimeout(() => {
          if (scrollViewRef.current) {
            scrollViewRef.current.scrollTo({ y: 400, animated: true });
          }
        }, 300);
      }, 1500);
      
    } catch (error) {
      console.error('❌ Failed to process photos step by step:', error);
      Alert.alert('Error', 'Failed to process photos with AI');
      setShowStepByStepOverlay(false);
    }
  };

  // Complete step-by-step processing with voice input and photo descriptions
  const completeStepByStepProcessing = async (voiceTranscript, photoDescriptions) => {
    try {
      console.log('🎯 Completing step-by-step processing with voice and photos');
      
      const finalStepIndex = mediaItems.length + 1; // After photos and voice
      
      // Move to final step and show it to user
      setCurrentStep(finalStepIndex);
      setCurrentStepDescription('Preparing review...');
      
      // Give user time to see the final step
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      // Update final step to completed
      setCurrentStepDescription('Analysis complete - ready for review!');
      setAiSteps(prev => prev.map((step, index) => 
        index === finalStepIndex ? { ...step, completed: true, description: 'Ready for review!' } : step
      ));
      
      console.log('✅ Step-by-step processing complete - showing review overlay');
      
      // Store the data for review overlay
      setReviewData({
        voiceInput: voiceTranscript,
        photoDescriptions: photoDescriptions,
        isGeneratingAI: false
      });
      
      // Set processed flag
      setStepByStepProcessed(true);
      
      // Close step-by-step overlay and show review overlay
      setTimeout(() => {
        console.log('🎯 Transitioning to review overlay');
        setShowStepByStepOverlay(false);
        setShowReviewOverlay(true);
      }, 1000);
      
    } catch (error) {
      console.error('❌ Failed to complete step-by-step processing:', error);
      Alert.alert('Error', 'Failed to process content');
      setShowStepByStepOverlay(false);
    }
  };

  // Generate AI Post from Review Overlay
  const handleGenerateAIPost = async () => {
    try {
      console.log('🚀 User clicked Generate AI Post button');
      
      // Update review overlay to show generating state
      setReviewData(prev => ({ ...prev, isGeneratingAI: true }));
      
      // Generate AI content - COMPLETELY IGNORE PHOTO, FOCUS ON VOICE
      const enhancedPrompt = `IGNORE THE IMAGE. Write a social media post ONLY about what the user said: "${reviewData.voiceInput}".

USER'S MESSAGE (ONLY FOCUS): "${reviewData.voiceInput}"
Photo context (ignore this): ${reviewData.photoDescriptions.join('. ')}

ABSOLUTE RULES:
- DO NOT describe what's in the photo
- Write ONLY about: "${reviewData.voiceInput}"
- If they mention feelings/thoughts not visible in photo, write about those
- Write casually and naturally like a real person would post
- Don't overuse slang abbreviations - keep it natural
- Make the post about their WORDS, not visual elements
- Generate a SHORT CATCHY TITLE (50 characters max) based on "${reviewData.voiceInput}"

EXAMPLES:
- Voice: "I'm so tired" → Write about being tired, NOT the laptop/coding
- Voice: "this coffee is amazing" → Write about coffee, even if not in photo
- Voice: "stressed about deadlines" → Focus on stress, not what's visible

The image is IRRELEVANT. Focus 100% on: "${reviewData.voiceInput}". Include a short title!`;
      console.log('🎤📸 Generating content FORCING user voice priority over photo content');
      
      const aiContent = await mediaDescriptionService.generateFullPostDataWithContext(
        mediaItems[0].uri,
        enhancedPrompt,
        reviewData.photoDescriptions
      );
      
      // Apply the AI content
      setMediaDescriptions(reviewData.photoDescriptions);
      setAiCaption(aiContent.description || '');
      setCaption(aiContent.description || '');
      setGeneratedHashtags(aiContent.hashtags || []);
      setGeneratedContent(aiContent);
      setContentView('ai');
      setUserRequestedAI(true);
      
      console.log('✅ AI post generated successfully:', aiContent.description);
      
      // Set protection flags
      justCompletedStepByStepRef.current = true;
      
      // Close review overlay
      setShowReviewOverlay(false);
      setReviewData({ voiceInput: '', photoDescriptions: [], isGeneratingAI: false });
      
      // Auto-scroll to show AI content
      setTimeout(() => {
        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({ y: 600, animated: true });
          console.log('📜 Auto-scrolled to AI Enhanced content section');
        }
      }, 300);
      
    } catch (error) {
      console.error('❌ Failed to generate AI post:', error);
      Alert.alert('Error', 'Failed to generate AI post. Please try again.');
      setReviewData(prev => ({ ...prev, isGeneratingAI: false }));
    }
  };

  // Handle voice description - push-to-talk for description overlay
  const handleVoiceDescriptionPressIn = () => {
    console.log('🎤 Starting push-to-talk voice description from overlay');
    
    if (!isTranscribing && !isGeneratingContent) {
      setIsRecordingFromOverlay(true); // Mark that we're recording from overlay
      startVoiceDescription().catch(error => {
        console.error('Voice recording error:', error);
        setIsRecordingFromOverlay(false);
      });
    }
  };

  const handleVoiceDescriptionPressOut = () => {
    console.log('🎤 Ending push-to-talk voice description from overlay');
    if (isRecording) {
      // Just stop recording, stay in overlay
      stopVoiceDescription().catch(error => {
        console.error('Voice recording error:', error);
      }).finally(() => {
        // Clear the flag after a short delay to ensure transcript processing is complete
        setTimeout(() => {
          console.log('🔄 Clearing isRecordingFromOverlay flag');
          setIsRecordingFromOverlay(false);
        }, 500);
      });
    } else {
      console.log('🎤 Not currently recording');
    }
  };

  // Handle voice description selection - use existing voice system (for backward compatibility)
  const handleVoiceDescription = () => {
    console.log('🎤 User chose voice description');
    setShowDescriptionMethodOverlay(false);
    
    // Set flag to trigger step-by-step processing after voice input
    setPendingStepByStepProcessing(true);
    
    console.log('🎯 Step-by-step processing will begin after voice input');
    
    Toast.show({
      type: 'info',
      text1: '🎤 Voice Recording',
      text2: 'Use the microphone button below to record',
      position: 'bottom',
    });
  };

  // Handle text description input
  const handleTextDescription = () => {
    console.log('✏️ User chose text description');
    // Keep the overlay open and show text input
    setShowTextInput(true);
    setDescriptionText('');
  };

  // Handle text input and proceed to step-by-step processing
  const handleTextSubmitWithAI = async () => {
    if (!descriptionText.trim()) {
      Alert.alert('Empty Description', 'Please enter a description first');
      return;
    }

    try {
      console.log('📝 Text description provided, starting step-by-step processing');
      
      // Set the caption and add to contextual data
      setOriginalCaption(descriptionText);
      setCaption(descriptionText);
      setAllContextualData(prev => ({
        ...prev,
        manualText: descriptionText
      }));
      
      // Set user requested AI flag
      setUserRequestedAI(true);
      
      // Clear the text input and close overlay
      setDescriptionText('');
      setShowTextInput(false);
      setShowDescriptionMethodOverlay(false);
      
      // Start step-by-step processing with user's description
      await initializeStepByStepProcessing();
      
    } catch (error) {
      console.error('❌ Failed to start step-by-step processing:', error);
      Alert.alert('Error', 'Failed to start AI processing');
    }
  };

  // Handle continuing without description (for camera flow)
  const handleContinueWithoutDescription = async () => {
    console.log('🚀 User chose to continue without description - starting step-by-step processing');
    
    // Set user requested AI flag
    setUserRequestedAI(true);
    
    // Close overlay
    setShowDescriptionMethodOverlay(false);
    
    // Reset the auto-trigger flag and start step-by-step processing
    setShouldAutoTriggerStepByStep(false);
    
    try {
      await initializeStepByStepProcessing();
    } catch (error) {
      console.error('❌ Failed to start step-by-step processing:', error);
      Alert.alert('Error', 'Failed to start AI processing');
    }
  };

  // Modified handleStopRecording to auto-trigger AI after voice input
  const handleStopRecordingWithAI = async () => {
    if (!voiceMemo || !isRecording) return;

    try {
      setIsRecording(false);
      await voiceMemo.stopAndUnloadAsync();
      
      const uri = voiceMemo.getURI();
      console.log('🎤 Recording stopped, URI:', uri);

      if (uri) {
        setIsTranscribing(true);
        
        // Transcribe the voice recording
        try {
          const transcript = await geminiSpeechService.transcribeAudio(uri);
          console.log('📝 Voice transcribed:', transcript);
          
          if (transcript && transcript.trim()) {
            setVoiceTranscript(transcript);
            setOriginalCaption(transcript);
            setCaption(transcript);
            
            // Add to accumulated voice inputs
            setAccumulatedVoiceInputs(prev => [...prev, transcript]);
            setAllContextualData(prev => ({
              ...prev,
              voiceInputs: [...prev.voiceInputs, transcript]
            }));
            
            // Automatically trigger step-by-step AI processing after voice input
            console.log('🤖 Auto-triggering step-by-step processing after voice description');
            setUserRequestedAI(true);
            setTimeout(() => {
              initializeStepByStepProcessing();
            }, 1000);
            
          } else {
            Alert.alert('Transcription Error', 'Could not understand the audio. Please try again.');
          }
        } catch (transcriptionError) {
          console.error('❌ Transcription failed:', transcriptionError);
          Alert.alert('Transcription Error', 'Failed to process voice recording');
        }
      }
      
      setVoiceMemo(null);
    } catch (error) {
      console.error('❌ Stop recording failed:', error);
      Alert.alert('Recording Error', 'Failed to stop recording');
    } finally {
      setIsTranscribing(false);
    }
  };

  // Take Photo handler with multi-photo support
  const handleTakePhoto = async () => {
    try {
      // Set multi-photo capture flag to prevent AI generation
      setIsCapturingMultiplePhotos(true);
      
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const newMediaItem = {
          ...result.assets[0],
          type: 'photo'
        };
        console.log('📷 Taking photo - new media item:', { type: newMediaItem.type, uri: newMediaItem.uri?.substring(0, 50) + '...' });
        
        setMediaItems(prevItems => {
          const updatedItems = [...prevItems, newMediaItem];
          console.log('📷 Total media items after photo:', updatedItems.length);
          
          // Show multi-photo option after adding the photo (but not during step-by-step processing)
          setTimeout(() => {
            setCurrentPhotoCount(updatedItems.length);
            // Don't show modal if step-by-step processing is active
            if (!showStepByStepOverlay && !stepByStepProcessed) {
              setShowMultiPhotoModal(true);
            }
          }, 500); // Small delay to ensure state is updated
          
          return updatedItems;
        });
        
        // Descriptions will be generated by useEffect, but full AI content will wait until user is done
      }
    } catch (error) {
      console.error('Camera error:', error);
      Alert.alert('Error', 'Failed to take photo');
      setIsCapturingMultiplePhotos(false); // Reset flag on error
    }
  };

  // Take Video handler  
  const handleTakeVideo = async () => {
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const newMediaItem = {
          ...result.assets[0],
          type: 'video'
        };
        setMediaItems(prevItems => [...prevItems, newMediaItem]);
        
        // Individual descriptions will be generated by useEffect
        // Full AI content will be generated after descriptions are ready
      }
    } catch (error) {
      console.error('Video camera error:', error);
      Alert.alert('Error', 'Failed to record video');
    }
  };

  const handleMediaLibraryPress = () => {
    addMediaFromLibrary().catch(error => {
      console.error('Media library error:', error);
    });
  };

  // Wrapper function for post button
  const handlePostPress = () => {
    handlePost().catch(error => {
      console.error('Post creation error:', error);
    });
  };

  const uploadMedia = async (mediaUri, mediaType) => {
    const user = auth.currentUser;
    if (!user) throw new Error('User not authenticated');

    console.log('📤 Starting media upload...');
    console.log('📤 Media URI:', mediaUri);
    console.log('📤 Media type:', mediaType);

    const response = await fetch(mediaUri);
    const blob = await response.blob();
    
    console.log('📤 Blob size:', blob.size);
    
    const fileExtension = mediaType === 'photo' ? 'jpg' : 'mp4';
    const fileName = `${mediaType}-${Date.now()}.${fileExtension}`;
    const storageRef = ref(storage, `users/${user.uid}/media/${fileName}`);
    
    console.log('📤 Uploading to:', fileName);
    
    // Add timeout to upload
    const uploadPromise = uploadBytes(storageRef, blob);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Upload timeout after 60 seconds')), 60000)
    );
    
    await Promise.race([uploadPromise, timeoutPromise]);
    
    console.log('📤 Upload complete, getting download URL...');
    
    const downloadURL = await getDownloadURL(storageRef);
    
    console.log('📤 Download URL:', downloadURL);
    
    let thumbnailUrl = null;
    
    // Generate thumbnail for videos
    if (mediaType === 'video') {
      try {
        console.log('🎬 Generating video thumbnail...');
        
        // Add timeout to prevent hanging
        const thumbnailPromise = VideoThumbnails.getThumbnailAsync(
          mediaUri,
          {
            time: 1000, // Get thumbnail at 1 second
            quality: 0.8,
          }
        );
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Thumbnail generation timeout')), 10000)
        );
        
        const { uri: thumbnailUri } = await Promise.race([thumbnailPromise, timeoutPromise]);
        
        console.log('✅ Thumbnail generated:', thumbnailUri);
        
        // Upload thumbnail
        const thumbnailResponse = await fetch(thumbnailUri);
        const thumbnailBlob = await thumbnailResponse.blob();
        
        const thumbnailFileName = `thumbnail-${Date.now()}.jpg`;
        const thumbnailStorageRef = ref(storage, `users/${user.uid}/thumbnails/${thumbnailFileName}`);
        
        await uploadBytes(thumbnailStorageRef, thumbnailBlob);
        thumbnailUrl = await getDownloadURL(thumbnailStorageRef);
        
        console.log('✅ Thumbnail uploaded:', thumbnailUrl);
        
      } catch (error) {
        console.error('⚠️ Failed to generate thumbnail:', error);
        console.log('📱 Continuing without thumbnail...');
        // Continue without thumbnail - better than failing the entire upload
      }
    }
    
    return {
      url: downloadURL,
      type: mediaType === 'photo' ? 'image/jpeg' : 'video/mp4',
      thumbnail: thumbnailUrl
    };
  };

  const handlePost = async () => {
    if (!caption.trim() && (!media || !media.uri)) {
      Alert.alert('Error', 'Please add a caption or media');
      return;
    }

    const user = auth.currentUser;
    
    console.log('🚀 Starting post creation...');
    console.log('🚀 Current user:', user);
    console.log('🚀 User UID:', user?.uid);
    console.log('🚀 Caption:', caption);
    console.log('🚀 Media:', media);
    
    if (!user) {
      Alert.alert('Error', 'Please log in to post');
      return;
    }

    setIsUploading(true);
    
    try {
      let uploadedMedia = [];
      
      if (mediaItems && mediaItems.length > 0) {
        console.log(`📤 Starting upload process for ${mediaItems.length} media items...`);
        
        for (let i = 0; i < mediaItems.length; i++) {
          const mediaItem = mediaItems[i];
          if (mediaItem.uri) {
            try {
              console.log(`📤 Uploading media ${i + 1}/${mediaItems.length}... Type: ${mediaItem.type}`);
              const mediaData = await uploadMedia(mediaItem.uri, mediaItem.type);
              uploadedMedia.push(mediaData);
            } catch (uploadError) {
              console.error(`📤 Media upload ${i + 1} failed:`, uploadError);
              
              // Ask user if they want to continue without this media
              const continueWithoutMedia = await new Promise((resolve) => {
                Alert.alert(
                  'Upload Failed',
                  `Media upload ${i + 1} failed. Would you like to continue?`,
                  [
                    { text: 'Cancel All', onPress: () => resolve(false) },
                    { text: 'Skip This Media', onPress: () => resolve(true) }
                  ]
                );
              });
              
              if (!continueWithoutMedia) {
                throw new Error('Upload cancelled by user');
              }
              
              console.log(`📤 Skipping failed media ${i + 1}...`);
            }
          }
        }
        
        console.log(`📤 Media upload completed: ${uploadedMedia.length}/${mediaItems.length} successful`);
      }

      // Determine post type based on media
      const hasVideo = uploadedMedia.some(m => m.type === 'video');
      const hasImage = uploadedMedia.some(m => m.type === 'image');
      const postType = hasVideo ? 'video' : hasImage ? 'image' : 'text';
      
      // Get primary media URLs for compatibility
      const primaryMedia = uploadedMedia[0];
      const videoUrl = hasVideo ? primaryMedia?.url : null;
      const imageUrl = hasImage ? primaryMedia?.url : null;

      // Extract thumbnail URL from the primary media
      const thumbnailUrl = uploadedMedia[0]?.thumbnail;
      
      const postData = {
        userId: user.uid,
        username: user.displayName || 'Anonymous',
        userPhotoURL: user.photoURL,
        title: generatedContent?.title || caption.substring(0, 50) || 'New Post',
        transcript: caption,
        description: generatedContent?.description || caption, // Use AI description if available
        caption: caption, // Keep original caption field
        tags: extractHashtags(caption),
        emoji: uploadedMedia.length > 0 ? '📸' : '💭',
        media: uploadedMedia,
        type: postType, // Add post type
        videoUrl: videoUrl, // Add direct video URL
        imageUrl: imageUrl, // Add direct image URL
        thumbnail: thumbnailUrl, // Add thumbnail URL for video posts
        user: { // Add user object for compatibility
          username: user.displayName || 'Anonymous',
          avatar: user.photoURL
        },
        likes: 0, // Add likes field
        comments: 0, // Add comments field  
        shares: 0, // Add shares field
        sharedTo: Object.keys(selectedPlatforms).filter(k => selectedPlatforms[k]),
        date: serverTimestamp(),
        likeCount: 0,
        commentCount: 0
      };

      console.log('=== SAVING POST TO FIREBASE ===');
      console.log('Post data:', postData);
      
      const docRef = await addDoc(collection(db, 'posts'), postData);
      
      console.log('✅ Post saved successfully with ID:', docRef.id);
      
      // Start AI comment generation immediately after upload
      setIsUploading(false); // Stop upload overlay
      setIsGeneratingComments(true); // Start comment generation overlay
      
      // Generate AI comments for the post
      console.log('🤖 Starting AI comment generation...');
      const aiComments = await generateAIComments(postData);
      setGeneratedComments(aiComments);
      
      setTimeout(() => {
        setIsGeneratingComments(false);
        Toast.show({
          type: 'success',
          text1: 'Post created with AI comments!',
          text2: `Generated ${aiComments.length} smart comments`,
          position: 'bottom',
        });
        navigation.navigate('MainTabs', { screen: 'Home' });
      }, 2000); // Show overlay for 2 seconds
      
    } catch (error) {
      console.error('Error posting:', error);
      Alert.alert('Error', 'Failed to post. Please try again.');
      setIsUploading(false);
      setIsGeneratingComments(false);
    }
  };

  // Generate comprehensive AI content using ALL available data
  const generateComprehensiveAIContent = async (bypassStepByStepCheck = false, voiceData = null, photoData = null) => {
    try {
      console.log('🧠 Starting comprehensive AI content generation...');
      
      // PREVENT running during step-by-step processing OR if already processed (unless bypassed)
      if (!bypassStepByStepCheck && (showStepByStepOverlay || stepByStepProcessed)) {
        console.log('🚫 Skipping comprehensive AI - step-by-step processing active or already completed');
        return;
      }
      
      console.log('📋 All contextual data:', allContextualData);
      console.log('🗣️ Voice data parameter:', voiceData);
      console.log('📸 Photo data parameter:', photoData);
      
      if (mediaItems.length === 0) {
        Alert.alert('No Media', 'Please add photos first');
        return;
      }
      
      // User explicitly requested AI generation
      setUserRequestedAI(true);
      
      // Only set generating state if not called from step-by-step (to prevent overlay conflicts)
      if (!bypassStepByStepCheck) {
        setIsGeneratingContent(true);
      }
      
      // Use provided photo data or generate/get from state
      let photoDescriptions = photoData || allContextualData.photoDescriptions;
      if (!photoDescriptions || photoDescriptions.length !== mediaItems.length) {
        console.log('📸 Photo descriptions missing, generating now...');
        await generateMediaDescriptions(true); // Force generation when user explicitly requests AI
        photoDescriptions = mediaDescriptions;
      }
      
      // Use provided voice data or get from state
      const voiceInputs = voiceData ? [voiceData] : allContextualData.voiceInputs;
      const manualText = allContextualData.manualText || manualDescription;
      
      console.log('🎯 Final voice inputs for comprehensive AI:', voiceInputs);
      console.log('🎯 Final photo descriptions for comprehensive AI:', photoDescriptions);
      
      // Create comprehensive context prompt - FORCE user input priority
      let contextPrompt = 'CRITICAL: Write about what the user SAID/WROTE - even if those things aren\'t visible in photos:\n\n';
      
      // Add voice inputs FIRST - this is the MAIN content
      if (voiceInputs.length > 0) {
        contextPrompt += '🎯 THE REAL STORY (user\'s words - 95% focus):\n';
        voiceInputs.forEach((voice, index) => {
          contextPrompt += `"${voice}"\n`;
        });
        contextPrompt += '\nThis is THE story - write about this even if photos don\'t show it.\n\n';
      }
      
      // Add manual text as primary if no voice
      if (manualText && manualText.trim() && voiceInputs.length === 0) {
        contextPrompt += `🎯 THE REAL STORY (user\'s message - 95% focus):\n"${manualText}"\n\nThis is THE story - write about this even if photos don\'t show it.\n\n`;
      } else if (manualText && manualText.trim()) {
        contextPrompt += `📝 Extra user context: ${manualText}\n\n`;
      }
      
      // Add photo descriptions as minimal visual context
      if (photoDescriptions.length > 0) {
        contextPrompt += '📸 Photo context (minor background only):\n';
        photoDescriptions.forEach((desc, index) => {
          contextPrompt += `${desc}\n`;
        });
        contextPrompt += '\n';
      }
      
      contextPrompt += 'CRITICAL RULES:\n- Write about what they SAID, even if not visible in photos\n- If they mention feelings/thoughts/activities not shown, INCLUDE THEM\n- Photos are just background - their words are the content\n- Write naturally and casually like a real person would post\n- Don\'t overuse slang abbreviations - keep it natural and relatable\n- Generate a SHORT CATCHY TITLE (50 characters max) based on their message\n- Their message is 95% of the post, photos are 5%\n- Focus on what they SAID, not what photos show';
      
      console.log('📝 Comprehensive context prompt:', contextPrompt);
      
      // Generate AI content with comprehensive context
      const aiContent = await mediaDescriptionService.generateFullPostDataWithContext(
        mediaItems[0].uri,
        contextPrompt,
        photoDescriptions
      );
      
      if (aiContent) {
        setGeneratedContent(aiContent);
        setAiCaption(aiContent.description);
        setCaption(aiContent.description);
        setGeneratedHashtags(aiContent.hashtags);
        setAiSuggestions(aiContent);
        setShowAiContent(true);
        setContentView('ai');
        
        Toast.show({
          type: 'success',
          text1: '🧠 Comprehensive AI Content Generated!',
          text2: `Used ${photoDescriptions.length} photos + ${voiceInputs.length} voice inputs`,
          position: 'bottom',
        });
      }
      
    } catch (error) {
      console.error('❌ Comprehensive AI generation failed:', error);
      Alert.alert('Error', 'Failed to generate comprehensive content');
    } finally {
      // Only reset generating state if not called from step-by-step
      if (!bypassStepByStepCheck) {
        setIsGeneratingContent(false);
      }
    }
  };

  // Generate AI comments for the post
  const generateAIComments = async (postData) => {
    try {
      console.log('🤖 Generating AI comments for post...');
      
      // Simulate AI comment generation (replace with actual AI service)
      const comments = [
        {
          id: 'ai-comment-1',
          username: 'AI_Assistant',
          text: 'Amazing content! The composition is really well done. 📸✨',
          timestamp: new Date(),
          isAI: true
        },
        {
          id: 'ai-comment-2', 
          username: 'ContentBot',
          text: 'Love the creative perspective here! Great work! 🔥',
          timestamp: new Date(),
          isAI: true
        },
        {
          id: 'ai-comment-3',
          username: 'SmartViewer',
          text: 'This really captures the mood perfectly. Inspiring! 💫',
          timestamp: new Date(), 
          isAI: true
        }
      ];
      
      // You can replace this with actual AI service call:
      // const comments = await aiService.generatePostComments(postData);
      
      return comments;
    } catch (error) {
      console.error('❌ AI comment generation failed:', error);
      return [];
    }
  };

  const extractHashtags = (text) => {
    const hashtagRegex = /#[\w]+/g;
    const hashtags = text.match(hashtagRegex) || [];
    return hashtags.map(tag => tag.substring(1)); // Remove the # symbol
  };

  const renderPlatformButton = (platform, icon, colors) => (
    <TouchableOpacity
      key={platform}
      style={[
        styles.platformButton,
        selectedPlatforms[platform] && { backgroundColor: colors[0] }
      ]}
      onPress={() => togglePlatform(platform)}
    >
      <Ionicons 
        name={icon} 
        size={20} 
        color={selectedPlatforms[platform] ? 'white' : '#9ca3af'} 
      />
      <Text style={[
        styles.platformText,
        selectedPlatforms[platform] && { color: 'white' }
      ]}>
        {platform.charAt(0).toUpperCase() + platform.slice(1)}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBackNavigation}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <BlypLogo useGradientBackground={false} textStyle={{ fontSize: 24 }} />
        <View style={{ width: 24 }} />
      </View>

      <ScrollView 
        ref={scrollViewRef} 
        style={styles.content} 
        showsVerticalScrollIndicator={false}
        onTouchStart={() => {
          // Stop voice recording when user taps anywhere during recording
          if (isRecording && pendingStepByStepProcessing) {
            console.log('👆 User tapped to stop recording');
            stopVoiceDescription().catch(error => {
              console.log('⚠️ Error stopping recording on tap:', error.message);
            });
          }
        }}
      >
        {/* Top Action Buttons */}
        <View style={styles.topActionButtons}>
          <TouchableOpacity 
            style={styles.topActionButton}
            onPress={handleTakePhoto}
          >
            <LinearGradient
              colors={['#10b981', '#059669']}
              style={styles.topActionGradient}
            >
              <Ionicons name="camera" size={24} color="white" />
              <Text style={styles.topActionText}>Take Photo</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.topActionButton}
            onPress={handleTakeVideo}
          >
            <LinearGradient
              colors={['#3b82f6', '#2563eb']}
              style={styles.topActionGradient}
            >
              <Ionicons name="videocam" size={24} color="white" />
              <Text style={styles.topActionText}>Take Video</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.topActionButton}
            onPress={startVoiceDescription}
          >
            <LinearGradient
              colors={['#a855f7', '#d946ef']}
              style={styles.topActionGradient}
            >
              <Ionicons name="mic" size={24} color="white" />
              <Text style={styles.topActionText}>Voice Note</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.topActionButton}
            onPress={handleMediaLibraryPress}
          >
            <LinearGradient
              colors={['#f59e0b', '#d97706']}
              style={styles.topActionGradient}
            >
              <Ionicons name="images" size={24} color="white" />
              <Text style={styles.topActionText}>My Media</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Multiple Media Display */}
        {mediaItems.length > 0 && (
          <View style={styles.mediaSection}>
            <View style={styles.mediaSectionHeader}>
              <Text style={styles.mediaSectionTitle}>
                Media ({mediaItems.length})
              </Text>
            </View>
            
            <View style={styles.mediaGrid}>
              {mediaItems.map((item, index) => (
                <TouchableOpacity key={index} style={styles.mediaCard} onPress={() => openMediaViewer(item, index)}>
                  {/* Media Item */}
                  <View style={styles.mediaItemContainer}>
                    {item.type === 'photo' ? (
                      <Image 
                        source={{ uri: item.uri }} 
                        style={styles.mediaItemPreview} 
                      />
                    ) : (
                      <Video
                        source={{ uri: item.uri }}
                        style={styles.mediaItemPreview}
                        useNativeControls={false}
                        resizeMode="cover"
                        isLooping={false}
                      />
                    )}
                    
                    {/* Remove Button */}
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={(e) => {
                        e.stopPropagation();
                        removeMediaItem(index);
                      }}
                    >
                      <Ionicons name="close-circle" size={16} color="#FF4444" />
                    </TouchableOpacity>
                  </View>
                  
                  {/* AI Description */}
                  <View style={styles.descriptionContainer}>
                    <Text style={styles.mediaDescription} numberOfLines={2}>
                      {mediaDescriptions[index] || 'Generating description...'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Comprehensive AI Data Summary */}
        {(allContextualData.photoDescriptions.length > 0 || allContextualData.voiceInputs.length > 0) && (
          <View style={styles.comprehensiveAiSection}>
            <View style={styles.aiSummaryHeader}>
              <Ionicons name="bulb" size={24} color="#a855f7" />
              <Text style={styles.aiSummaryTitle}>AI Data Collected</Text>
            </View>
            
            {/* Photo Descriptions Summary */}
            {allContextualData.photoDescriptions.length > 0 && (
              <View style={styles.aiDataItem}>
                <Text style={styles.aiDataLabel}>📸 Photo Descriptions: {allContextualData.photoDescriptions.length}</Text>
                <Text style={styles.aiDataPreview} numberOfLines={2}>
                  {allContextualData.photoDescriptions.join(' • ')}
                </Text>
              </View>
            )}
            
            {/* Voice Inputs Summary */}
            {allContextualData.voiceInputs.length > 0 && (
              <View style={styles.aiDataItem}>
                <Text style={styles.aiDataLabel}>🗣️ Voice Inputs: {allContextualData.voiceInputs.length}</Text>
                <Text style={styles.aiDataPreview} numberOfLines={2}>
                  {allContextualData.voiceInputs.join(' • ')}
                </Text>
              </View>
            )}
            
            {/* Comprehensive AI Generate Button - HIDDEN */}
            <TouchableOpacity
              style={[styles.comprehensiveAiButton, { display: 'none' }]}
              onPress={generateComprehensiveAIContent}
              disabled={isGeneratingContent}
            >
              <LinearGradient
                colors={isGeneratingContent ? ['#6b7280', '#6b7280'] : ['#a855f7', '#d946ef', '#ec4899']}
                style={styles.comprehensiveAiGradient}
              >
                {isGeneratingContent ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Ionicons name="bulb" size={24} color="white" />
                )}
                <Text style={styles.comprehensiveAiButtonText}>
                  {isGeneratingContent ? 'Generating...' : 'Generate Comprehensive AI Post'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* AI Voice Description Section */}
        <View style={styles.aiVoiceSection}>
          <TouchableOpacity
            style={[
              styles.voiceButton,
              isRecording && styles.voiceButtonRecording,
              isTranscribing && styles.voiceButtonProcessing
            ]}
            onPressIn={handleVoiceButtonPressIn}
            onPressOut={handleVoiceButtonPressOut}
            disabled={isTranscribing || isGeneratingContent}
          >
            <LinearGradient
              colors={isRecording ? ['#ff4444', '#ff6b6b'] : ['#a855f7', '#d946ef']}
              style={styles.voiceButtonGradient}
            >
              {isTranscribing ? (
                <ActivityIndicator size="large" color="white" />
              ) : (
                <Ionicons 
                  name={isRecording ? "stop" : "mic"} 
                  size={32} 
                  color="white" 
                />
              )}
            </LinearGradient>
          </TouchableOpacity>
          
          <View style={styles.voiceStatusContainer}>
            <Text style={styles.voiceStatusTitle}>
              {isTranscribing ? 'Processing with AI...' :
               isRecording ? 'Listening...' : 
               'Hold to Describe'}
            </Text>
            <Text style={styles.voiceStatusSubtitle}>
              {isTranscribing ? 'Converting speech to text for editing' :
               isRecording ? `Recording: ${Math.floor(recordingDuration / 1000)}s` : 
               'Hold button and speak - text will appear below for editing'}
            </Text>

          </View>
        </View>

        {/* Manual Text Description Section */}
        <View style={styles.manualDescriptionSection}>
          <TouchableOpacity 
            style={styles.collapsibleHeader}
            onPress={() => setIsManualDescriptionExpanded(!isManualDescriptionExpanded)}
          >
            <Text style={styles.sectionLabel}>Or describe in text:</Text>
            <Ionicons 
              name={isManualDescriptionExpanded ? "chevron-up" : "chevron-down"} 
              size={20} 
              color="#9ca3af" 
            />
          </TouchableOpacity>
          
          {isManualDescriptionExpanded && (
            <View style={styles.manualTextContainer}>
              <TextInput
                style={styles.manualTextInput}
                placeholder="Type your description here..."
                placeholderTextColor="#888"
                value={manualDescription}
                onChangeText={(text) => {
                  setManualDescription(text);
                  // Update contextual data
                  setAllContextualData(prev => ({
                    ...prev,
                    manualText: text
                  }));
                  // Auto-expand if user starts typing
                  if (text.length > 0 && !isManualDescriptionExpanded) {
                    setIsManualDescriptionExpanded(true);
                  }
                }}
                onFocus={() => {
                  // Auto-expand when focused
                  if (!isManualDescriptionExpanded) {
                    setIsManualDescriptionExpanded(true);
                  }
                }}
                multiline={true}
                numberOfLines={3}
                maxLength={500}
                returnKeyType="default"
                blurOnSubmit={false}
              />
              
              <TouchableOpacity 
                style={[styles.enhanceFromTextButton, !manualDescription.trim() && styles.enhanceButtonDisabled]}
                onPress={() => handleEnhanceFromText()}
                disabled={!manualDescription.trim() || isGeneratingFromText}
              >
                <LinearGradient
                  colors={!manualDescription.trim() ? ['#666', '#666'] : ['#a855f7', '#d946ef']}
                  style={styles.enhanceFromTextGradient}
                >
                  {isGeneratingFromText ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={20} color="white" />
                      <Text style={styles.enhanceFromTextButtonText}>Enhance with AI</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* AI Generated Content Display */}
        {generatedContent && (
        <View style={styles.aiContentSection}>
          <View style={styles.contentToggleContainer}>
            <TouchableOpacity 
              style={[styles.contentToggleButton, contentView === 'ai' && styles.activeToggleButton]}
              onPress={() => {
                setContentView('ai');
                setCaption(aiCaption);
              }}
            >
              <Ionicons name="sparkles" size={18} color={contentView === 'ai' ? "white" : "#a855f7"} />
              <Text style={[styles.toggleButtonText, contentView === 'ai' && styles.activeToggleText]}>AI Enhanced</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.contentToggleButton, contentView === 'original' && styles.activeToggleButton]}
              onPress={() => {
                setContentView('original');
                setCaption(originalCaption);
              }}
            >
              <Ionicons name="document-text" size={18} color={contentView === 'original' ? "white" : "#6b7280"} />
              <Text style={[styles.toggleButtonText, contentView === 'original' && styles.activeToggleText]}>Original</Text>
            </TouchableOpacity>
          </View>
          
          {/* Voice Transcript Box - Only shown in Original mode */}
          {(contentView === 'original' && voiceTranscript) && (
            <View style={styles.transcriptContainer}>
              <Text style={styles.transcriptLabel}>🎤 Audio Recorded</Text>
              <TextInput
                style={styles.transcriptInput}
                value={originalCaption || ''}
                onChangeText={(text) => {
                  setOriginalCaption(text);
                  setCaption(text);
                }}
                multiline={true}
                placeholder="Audio recorded. Type what you said here, then tap enhance with AI for magic."
                placeholderTextColor="#888"
              />
              
              <TouchableOpacity 
                style={styles.enhanceAiButton}
                onPress={() => handleUseTranscript()}
              >
                <LinearGradient
                  colors={['#a855f7', '#d946ef']}
                  style={styles.enhanceAiGradient}
                >
                  <Ionicons name="sparkles" size={20} color="white" />
                  <Text style={styles.enhanceAiButtonText}>Enhance with AI</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
          
          {/* Editable Caption - Hide in Original mode when transcript exists */}
          {!(contentView === 'original' && voiceTranscript) && (
            <View style={styles.aiDescriptionBox}>
              {/* AI Generated Title */}
              {contentView === 'ai' && generatedContent?.title && (
                <View style={styles.aiTitleContainer}>
                  <Text style={styles.aiTitleLabel}>Post Title</Text>
                  <TextInput
                    style={styles.aiTitleInput}
                    placeholder="Edit your title..."
                    placeholderTextColor="#9ca3af"
                    value={generatedContent?.title || ''}
                    onChangeText={(text) => {
                      if (generatedContent) {
                        setGeneratedContent({...generatedContent, title: text});
                      }
                    }}
                    maxLength={50}
                    returnKeyType="done"
                  />
                  <Text style={styles.characterCount}>{(generatedContent?.title || '').length}/50</Text>
                </View>
              )}
              
              {/* Description Input */}
              <TextInput
                style={styles.aiCaptionInput}
                placeholder="Edit your caption..."
                placeholderTextColor="#9ca3af"
                value={caption || ''}
                onChangeText={(text) => {
                  setCaption(text);
                  if (contentView === 'ai') {
                    setAiCaption(text);
                  } else {
                    setOriginalCaption(text);
                  }
                }}
                multiline
                maxLength={500}
                returnKeyType="default"
                blurOnSubmit={false}
              />
            </View>
          )}

            {/* Generated Hashtags */}
            {Array.isArray(generatedHashtags) && generatedHashtags.length > 0 && (
              <View style={styles.hashtagContainer}>
                <Text style={styles.hashtagLabel}>Generated Hashtags:</Text>
                <View style={styles.hashtagList}>
                  {generatedHashtags.filter(tag => tag && typeof tag === 'string').map((tag, index) => (
                    <TouchableOpacity key={index} style={styles.hashtagChip}>
                      <LinearGradient
                        colors={['#a855f7', '#d946ef', '#ec4899']}
                        style={styles.hashtagGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                      >
                        <Text style={styles.hashtagText}>#{tag}</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Use AI Content Button */}
            <TouchableOpacity
              style={styles.useAiButton}
              onPress={() => {
                setCaption(generatedContent.description);
                setShowAiContent(false);
                Toast.show({
                  type: 'success',
                  text1: 'AI content applied!',
                  position: 'bottom',
                });
              }}
            >
              <Text style={styles.useAiButtonText}>Use AI Content</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Media Preview */}

        {/* Action Buttons */}
        {!showAiContent && (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleMediaLibraryPress}
            >
              <Ionicons name="images" size={20} color="#9ca3af" />
              <Text style={styles.actionButtonText}>Add Media</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                // Generate hashtags for current content
                if (caption.trim()) {
                  aiService.generateHashtags(caption, media ? [media] : [])
                    .then(hashtags => {
                      setGeneratedHashtags(hashtags);
                      Toast.show({
                        type: 'success',
                        text1: 'Hashtags generated!',
                        position: 'bottom',
                      });
                    })
                    .catch(() => {
                      Toast.show({
                        type: 'error',
                        text1: 'Failed to generate hashtags',
                        position: 'bottom',
                      });
                    });
                }
              }}
            >
              <Ionicons name="pricetag" size={20} color="#9ca3af" />
              <Text style={styles.actionButtonText}>Generate #</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Social Platforms */}
        <View style={styles.platformsContainer}>
          <Text style={styles.sectionTitle}>Share to (optional)</Text>
          <View style={styles.platformsGrid}>
            {renderPlatformButton('facebook', 'logo-facebook', ['#1877F2'])}
            {renderPlatformButton('instagram', 'logo-instagram', ['#E4405F'])}
            {renderPlatformButton('tiktok', 'musical-notes', ['#000000'])}
            {renderPlatformButton('youtube', 'logo-youtube', ['#FF0000'])}
          </View>
        </View>

        {/* Bottom Spacer */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Post Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.postButton, (isUploading || isGeneratingContent) && styles.postButtonDisabled]}
          onPress={handlePostPress}
          disabled={isUploading || isGeneratingContent}
        >
          <LinearGradient
            colors={(isUploading || isGeneratingContent) ? ['#6b7280', '#6b7280'] : ['#a855f7', '#d946ef', '#ec4899']}
            style={styles.postGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {isUploading ? (
              <>
                <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                <Text style={styles.postButtonText}>Posting...</Text>
              </>
            ) : isGeneratingContent ? (
              <>
                <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                <Text style={styles.postButtonText}>Enhancing...</Text>
              </>
            ) : (
              <Text style={styles.postButtonText}>Accept & Save</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
      
      {/* Media Viewer Modal */}
      <Modal
        visible={showMediaViewer}
        transparent={true}
        animationType="fade"
        onRequestClose={closeMediaViewer}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {selectedMedia && (
              <>
                {/* Header with close button */}
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Media {selectedMedia.index + 1}</Text>
                  <TouchableOpacity onPress={closeMediaViewer} style={styles.closeButton}>
                    <Ionicons name="close" size={24} color="white" />
                  </TouchableOpacity>
                </View>
                
                {/* Media Content */}
                <View style={styles.modalMediaContainer}>
                  {selectedMedia.type === 'photo' ? (
                    <Image 
                      source={{ uri: selectedMedia.uri }} 
                      style={styles.modalMediaPreview}
                      resizeMode="contain"
                    />
                  ) : (
                    <Video
                      source={{ uri: selectedMedia.uri }}
                      style={styles.modalMediaPreview}
                      useNativeControls
                      resizeMode="contain"
                      isLooping={false}
                    />
                  )}
                </View>
                
                {/* Description */}
                {mediaDescriptions[selectedMedia.index] && (
                  <View style={styles.modalDescriptionContainer}>
                    <Text style={styles.modalDescriptionLabel}>AI Description:</Text>
                    <Text style={styles.modalDescription}>
                      {mediaDescriptions[selectedMedia.index]}
                    </Text>
                  </View>
                )}
                
                {/* Action Buttons */}
                <View style={styles.modalActions}>
                  <TouchableOpacity 
                    style={styles.modalActionButton}
                    onPress={() => {
                      removeMediaItem(selectedMedia.index);
                      closeMediaViewer();
                    }}
                  >
                    <LinearGradient
                      colors={['#ef4444', '#dc2626']}
                      style={styles.modalActionGradient}
                    >
                      <Ionicons name="trash" size={20} color="white" />
                      <Text style={styles.modalActionText}>Remove</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* AI Description Generation Overlay */}
      <Modal
        visible={isGeneratingDescriptions}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.aiOverlay}>
          <View style={styles.aiOverlayContent}>
            <LinearGradient
              colors={['#a855f7', '#d946ef', '#ec4899']}
              style={styles.aiOverlayGradient}
            >
              <View style={styles.aiIconContainer}>
                <Ionicons name="sparkles" size={48} color="white" />
              </View>
              <Text style={styles.aiOverlayTitle}>Analyzing Media</Text>
              <Text style={styles.aiOverlaySubtitle}>AI is examining your photos and videos...</Text>
              <View style={styles.aiLoadingContainer}>
                <ActivityIndicator size="large" color="white" />
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* AI Content Generation Overlay */}
      <Modal
        visible={isGeneratingContent || isGeneratingDescriptions || isProcessingAllAI}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.aiOverlay}>
          <View style={styles.aiOverlayContent}>
            <LinearGradient
              colors={['#10b981', '#059669', '#047857']}
              style={styles.aiOverlayGradient}
            >
              <View style={styles.aiIconContainer}>
                <Ionicons name="create" size={48} color="white" />
              </View>
              <Text style={styles.aiOverlayTitle}>Creating Your Post</Text>
              <Text style={styles.aiOverlaySubtitle}>AI is writing the perfect caption...</Text>
              <View style={styles.aiLoadingContainer}>
                <ActivityIndicator size="large" color="white" />
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* Upload Loading Overlay */}
      <Modal
        visible={isUploading}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.aiOverlay}>
          <View style={styles.aiOverlayContent}>
            <LinearGradient
              colors={['#8b5cf6', '#7c3aed', '#6d28d9']}
              style={styles.aiOverlayGradient}
            >
              <View style={styles.aiIconContainer}>
                <Ionicons name="cloud-upload" size={48} color="white" />
              </View>
              <Text style={styles.aiOverlayTitle}>Uploading Your Post</Text>
              <Text style={styles.aiOverlaySubtitle}>Preparing your content...</Text>
              <View style={styles.aiLoadingContainer}>
                <ActivityIndicator size="large" color="white" />
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* AI Comment Generation Overlay */}
      <Modal
        visible={isGeneratingComments}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.aiOverlay}>
          <View style={styles.aiOverlayContent}>
            <LinearGradient
              colors={['#a855f7', '#d946ef', '#ec4899']}
              style={styles.aiOverlayGradient}
            >
              <View style={styles.aiIconContainer}>
                <Ionicons name="sparkles" size={48} color="white" />
              </View>
              <Text style={styles.aiOverlayTitle}>Blyp AI Processing</Text>
              <Text style={styles.aiOverlaySubtitle}>Blyp AI is now generating your post...</Text>
              <View style={styles.aiLoadingContainer}>
                <ActivityIndicator size="large" color="white" />
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* Step-by-Step AI Progress Modal */}
      <Modal
        visible={showStepByStepOverlay}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.stepByStepOverlay}>
          <View style={styles.stepByStepContent}>
            <LinearGradient
              colors={['#a855f7', '#d946ef', '#ec4899']}
              style={styles.stepByStepGradient}
            >
              {/* Header */}
              <View style={styles.stepByStepHeader}>
                <View style={styles.stepByStepIconContainer}>
                  <Ionicons name="sparkles" size={32} color="white" />
                </View>
                <Text style={styles.stepByStepTitle}>Creating Your Post</Text>
                <Text style={styles.stepByStepSubtitle}>
                  AI is processing your photos and voice input
                </Text>
              </View>

              {/* Steps List */}
              <View style={styles.stepsContainer}>
                {aiSteps.map((step, index) => (
                  <View key={index} style={styles.stepItem}>
                    <View style={[
                      styles.stepNumber,
                      index <= currentStep ? styles.stepNumberActive : styles.stepNumberInactive,
                      step.isVoice && { backgroundColor: '#8b5cf6' }
                    ]}>
                      {step.isVoice ? (
                        index < currentStep ? (
                          <Ionicons name="checkmark" size={16} color="white" />
                        ) : index === currentStep ? (
                          <ActivityIndicator size="small" color="white" />
                        ) : (
                          <Ionicons name="mic" size={14} color="white" />
                        )
                      ) : (
                        index < currentStep ? (
                          <Ionicons name="checkmark" size={16} color="white" />
                        ) : index === currentStep ? (
                          <ActivityIndicator size="small" color="white" />
                        ) : (
                          <Text style={styles.stepNumberText}>{index + 1}</Text>
                        )
                      )}
                    </View>
                    <View style={styles.stepContent}>
                      <Text style={[
                        styles.stepTitle,
                        index <= currentStep ? styles.stepTitleActive : styles.stepTitleInactive
                      ]}>
                        {step.title}
                      </Text>
                      {step.description && (
                        <Text style={[
                          styles.stepDescription,
                          index <= currentStep ? styles.stepDescriptionActive : styles.stepDescriptionInactive,
                          step.isVoice && { fontStyle: 'italic', color: '#a78bfa' }
                        ]}>
                          {step.isVoice && step.completed ? `"${step.fullDescription || step.description}"` : step.description}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>

              {/* Current Step Description */}
              {currentStepDescription && (
                <View style={styles.currentStepDescriptionContainer}>
                  <Text style={styles.currentStepDescriptionText}>
                    {currentStepDescription}
                  </Text>
                </View>
              )}
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* Review Overlay Modal */}
      <Modal
        visible={showReviewOverlay}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.reviewOverlay}>
          <View style={styles.reviewContent}>
            <LinearGradient
              colors={['#a855f7', '#d946ef', '#ec4899']}
              style={styles.reviewGradient}
            >
              {/* Header */}
              <View style={styles.reviewHeader}>
                <View style={styles.reviewIconContainer}>
                  <Ionicons name="document-text" size={32} color="white" />
                </View>
                <Text style={styles.reviewTitle}>Review & Generate</Text>
                <Text style={styles.reviewSubtitle}>
                  Review your content before generating AI post
                </Text>
              </View>

              {/* Voice Input Section */}
              {reviewData.voiceInput && (
                <View style={styles.reviewSection}>
                  <View style={styles.reviewSectionHeader}>
                    <Ionicons name="mic" size={20} color="white" />
                    <Text style={styles.reviewSectionTitle}>Voice Input</Text>
                  </View>
                  <View style={styles.reviewContentBox}>
                    <Text style={styles.reviewContentText}>
                      "{reviewData.voiceInput}"
                    </Text>
                  </View>
                </View>
              )}

              {/* Photo Descriptions Section */}
              {reviewData.photoDescriptions && reviewData.photoDescriptions.length > 0 && (
                <View style={styles.reviewSection}>
                  <View style={styles.reviewSectionHeader}>
                    <Ionicons name="images" size={20} color="white" />
                    <Text style={styles.reviewSectionTitle}>
                      Photo Description{reviewData.photoDescriptions.length > 1 ? 's' : ''}
                    </Text>
                  </View>
                  <ScrollView style={styles.reviewDescriptionsContainer} nestedScrollEnabled={true}>
                    {reviewData.photoDescriptions.map((description, index) => (
                      <View key={index} style={styles.reviewContentBox}>
                        <Text style={styles.reviewDescriptionNumber}>Photo {index + 1}</Text>
                        <Text style={styles.reviewContentText}>{description}</Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Generate Button */}
              <TouchableOpacity
                style={[
                  styles.generateAIButton,
                  reviewData.isGeneratingAI && styles.generateAIButtonDisabled
                ]}
                onPress={handleGenerateAIPost}
                disabled={reviewData.isGeneratingAI}
              >
                <LinearGradient
                  colors={reviewData.isGeneratingAI ? 
                    ['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.1)'] : 
                    ['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.1)']
                  }
                  style={styles.generateAIButtonGradient}
                >
                  {reviewData.isGeneratingAI ? (
                    <>
                      <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                      <Text style={styles.generateAIButtonText}>Generating AI Post...</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={20} color="white" style={{ marginRight: 8 }} />
                      <Text style={styles.generateAIButtonText}>Generate AI Post</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
              
              {/* Close Button */}
              {!reviewData.isGeneratingAI && (
                <TouchableOpacity
                  style={styles.reviewCloseButton}
                  onPress={() => setShowReviewOverlay(false)}
                >
                  <Text style={styles.reviewCloseButtonText}>Cancel</Text>
                </TouchableOpacity>
              )}
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* Description Method Selection Modal */}
      <Modal
        visible={showDescriptionMethodOverlay}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.descriptionMethodOverlay}>
          <View style={styles.descriptionMethodContent}>
            <LinearGradient
              colors={['#3b82f6', '#1d4ed8', '#1e40af']}
              style={styles.descriptionMethodGradient}
            >
              {/* Header */}
              <View style={styles.descriptionMethodHeader}>
                <View style={styles.descriptionMethodIconContainer}>
                  <Ionicons name="chatbubble-ellipses" size={32} color="white" />
                </View>
                <Text style={styles.descriptionMethodTitle}>Add Description</Text>
                <Text style={styles.descriptionMethodSubtitle}>
                  How would you like to describe your photos?
                </Text>
              </View>

              {/* Voice Description Option - Push to Talk */}
              <TouchableOpacity
                style={[
                  styles.descriptionMethodOption,
                  isRecording && { backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444' }
                ]}
                onPressIn={handleVoiceDescriptionPressIn}
                onPressOut={handleVoiceDescriptionPressOut}
                activeOpacity={0.8}
              >
                <View style={[
                  styles.descriptionOptionIconContainer,
                  isRecording && { backgroundColor: '#ef4444' }
                ]}>
                  <Ionicons 
                    name={isRecording ? "mic" : "mic-outline"} 
                    size={24} 
                    color={isRecording ? "white" : "#3b82f6"} 
                  />
                </View>
                <View style={styles.descriptionOptionContent}>
                  <Text style={styles.descriptionOptionTitle}>
                    {isRecording ? 'Recording...' : 'Push to Describe'}
                  </Text>
                  <Text style={styles.descriptionOptionSubtitle}>
                    {isRecording ? 'Release to finish' : 'Hold to speak your description'}
                  </Text>
                </View>
                {isRecording ? (
                  <View style={styles.recordingIndicator}>
                    <View style={styles.recordingDot} />
                  </View>
                ) : (
                  <Ionicons name="hand-left" size={20} color="rgba(255,255,255,0.7)" />
                )}
              </TouchableOpacity>

              {/* Text Input Option */}
              <TouchableOpacity
                style={styles.descriptionMethodOption}
                onPress={handleTextDescription}
              >
                <View style={styles.descriptionOptionIconContainer}>
                  <Ionicons name="create" size={24} color="#3b82f6" />
                </View>
                <View style={styles.descriptionOptionContent}>
                  <Text style={styles.descriptionOptionTitle}>Type Description</Text>
                  <Text style={styles.descriptionOptionSubtitle}>Write your description</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>

              {/* Text Input Box (shown when text option is selected) */}
              {showTextInput && (
                <View style={styles.textInputContainer}>
                  <TextInput
                    style={styles.descriptionTextInput}
                    placeholder="Describe your photos..."
                    placeholderTextColor="rgba(255,255,255,0.7)"
                    value={descriptionText}
                    onChangeText={setDescriptionText}
                    multiline={true}
                    numberOfLines={3}
                  />
                  <TouchableOpacity
                    style={styles.textSubmitButton}
                    onPress={handleTextSubmitWithAI}
                  >
                    <Text style={styles.textSubmitButtonText}>Generate AI Post</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Continue with Voice button removed - now auto-continues after voice recording */}

              {/* Continue without description (only show when coming from camera) */}
              {shouldAutoTriggerStepByStep && (
                <TouchableOpacity
                  style={[styles.descriptionMethodOption, { opacity: 0.8, marginTop: 10 }]}
                  onPress={handleContinueWithoutDescription}
                >
                  <View style={styles.descriptionOptionIconContainer}>
                    <Ionicons name="arrow-forward-circle" size={24} color="#10b981" />
                  </View>
                  <View style={styles.descriptionOptionContent}>
                    <Text style={styles.descriptionOptionTitle}>Continue Without Description</Text>
                    <Text style={styles.descriptionOptionSubtitle}>Process photos as-is</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
                </TouchableOpacity>
              )}
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* Multi-Photo Choice Modal */}
      <Modal
        visible={showMultiPhotoModal}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.multiPhotoModalOverlay}>
          <View style={styles.multiPhotoModalContent}>
            <LinearGradient
              colors={['#a855f7', '#d946ef', '#ec4899']}
              style={styles.multiPhotoModalGradient}
            >
              {/* Header with camera icon */}
              <View style={styles.multiPhotoModalHeader}>
                <View style={styles.multiPhotoIconContainer}>
                  <Ionicons name="camera" size={32} color="white" />
                </View>
                <Text style={styles.multiPhotoModalTitle}>Photo Captured!</Text>
                <Text style={styles.multiPhotoModalSubtitle}>
                  You now have {currentPhotoCount} photo{currentPhotoCount > 1 ? 's' : ''}
                </Text>
              </View>

              {/* Options */}
              <View style={styles.multiPhotoModalActions}>
                <TouchableOpacity 
                  style={styles.multiPhotoActionButton}
                  onPress={handleTakeAnotherPhoto}
                >
                  <View style={styles.multiPhotoActionContent}>
                    <Ionicons name="camera-outline" size={24} color="white" />
                    <Text style={styles.multiPhotoActionText}>Take Another Photo</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.multiPhotoActionButton, styles.multiPhotoSecondaryButton]}
                  onPress={handleContinueWithPost}
                >
                  <View style={styles.multiPhotoActionContent}>
                    <Ionicons name="checkmark-circle-outline" size={24} color="white" />
                    <Text style={styles.multiPhotoActionText}>Continue with Post</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* Back Navigation Confirmation Modal */}
      <Modal
        visible={showBackConfirmation}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowBackConfirmation(false)}
      >
        <View style={styles.confirmationModalOverlay}>
          <View style={styles.confirmationModalContent}>
            <LinearGradient
              colors={['#1e293b', '#334155', '#475569']}
              style={styles.confirmationModalGradient}
            >
              {/* Header */}
              <View style={styles.confirmationModalHeader}>
                <Ionicons name="warning-outline" size={48} color="#f59e0b" />
                <Text style={styles.confirmationModalTitle}>Unsaved Changes</Text>
                <Text style={styles.confirmationModalSubtitle}>
                  You have unsaved content. What would you like to do?
                </Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.confirmationModalActions}>
                {/* Save as Draft */}
                <TouchableOpacity 
                  style={styles.confirmationActionButton}
                  onPress={handleSaveAsDraft}
                >
                  <LinearGradient
                    colors={['#10b981', '#059669']}
                    style={styles.confirmationActionGradient}
                  >
                    <Ionicons name="bookmark-outline" size={24} color="white" />
                    <Text style={styles.confirmationActionText}>Save as Draft</Text>
                  </LinearGradient>
                </TouchableOpacity>

                {/* Discard Changes */}
                <TouchableOpacity 
                  style={styles.confirmationActionButton}
                  onPress={handleDiscardChanges}
                >
                  <LinearGradient
                    colors={['#ef4444', '#dc2626']}
                    style={styles.confirmationActionGradient}
                  >
                    <Ionicons name="trash-outline" size={24} color="white" />
                    <Text style={styles.confirmationActionText}>Discard Changes</Text>
                  </LinearGradient>
                </TouchableOpacity>

                {/* Cancel */}
                <TouchableOpacity 
                  style={[styles.confirmationActionButton, styles.cancelButton]}
                  onPress={() => setShowBackConfirmation(false)}
                >
                  <Text style={styles.cancelButtonText}>Continue Editing</Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    padding: 16,
  },

  // Top Action Buttons
  topActionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  topActionButton: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  topActionGradient: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  topActionText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  
  // AI Voice Section
  aiVoiceSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  voiceButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginRight: 16,
  },
  voiceButtonRecording: {
    transform: [{ scale: 1.1 }],
  },
  voiceButtonProcessing: {
    opacity: 0.8,
  },
  voiceButtonGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceStatusContainer: {
    flex: 1,
  },
  voiceStatusTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  voiceStatusSubtitle: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
  },
  demoModeText: {
    color: '#f59e0b',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },

  // Manual Description Section
  manualDescriptionSection: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#374151',
  },
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  sectionLabel: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 0,
  },
  manualTextContainer: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginTop: 12,
  },
  manualTextInput: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
    minHeight: 80,
    maxHeight: 120,
    marginBottom: 16,
  },
  enhanceFromTextButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  enhanceButtonDisabled: {
    opacity: 0.5,
  },
  enhanceFromTextGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  enhanceFromTextButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },

  // AI Content Section
  aiContentSection: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#a855f7',
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  aiTitle: {
    color: '#a855f7',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  contentToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  contentToggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  activeToggleButton: {
    backgroundColor: '#a855f7',
  },
  toggleButtonText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  activeToggleText: {
    color: 'white',
  },
  transcriptContainer: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#6b7280',
  },
  transcriptLabel: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  transcriptInput: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 12,
    color: '#ffffff',
    fontSize: 16,
    minHeight: 80,
    maxHeight: 120,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 12,
  },
  enhanceAiButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  enhanceAiGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  enhanceAiButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  aiDescriptionBox: {
    backgroundColor: '#374151',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  aiDescriptionText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 24,
  },
  aiCaptionInput: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
    minHeight: 60,
    maxHeight: 120,
  },
  
  // AI Title Styles
  aiTitleContainer: {
    marginBottom: 16,
  },
  aiTitleLabel: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  aiTitleInput: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    backgroundColor: '#4b5563',
    borderRadius: 8,
    padding: 12,
    marginBottom: 4,
  },
  characterCount: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'right',
  },
  
  hashtagContainer: {
    marginBottom: 16,
  },
  hashtagLabel: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  hashtagList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hashtagChip: {
    borderRadius: 20,
  },
  hashtagGradient: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  hashtagText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  useAiButton: {
    backgroundColor: '#a855f7',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  useAiButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Media Section
  mediaContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  mediaPreview: {
    width: '100%',
    height: 300,
    backgroundColor: '#374151',
  },
  
  // Multiple Media Section
  mediaSection: {
    marginBottom: 16,
  },
  mediaSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  mediaSectionTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingText: {
    color: '#9CA3AF',
    fontSize: 12,
    marginLeft: 8,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: 10,
  },
  mediaCard: {
    margin: 4,
    width: '45%',
    maxWidth: 180,
    minWidth: 120,
  },
  mediaItemContainer: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#374151',
  },
  mediaItemPreview: {
    width: '100%',
    aspectRatio: 1,
    minHeight: 80,
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 10,
  },
  descriptionContainer: {
    backgroundColor: '#1e293b',
    padding: 4,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  mediaDescription: {
    color: '#D1D5DB',
    fontSize: 10,
    lineHeight: 12,
  },

  // Caption Section
  captionContainer: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  captionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  captionLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  enhanceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#a855f7',
  },
  enhanceButtonText: {
    color: '#a855f7',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  captionInput: {
    color: '#ffffff',
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 8,
  },
  characterCount: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 12,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#374151',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
  },
  actionButtonText: {
    color: '#9ca3af',
    fontSize: 14,
    marginLeft: 6,
  },

  // Platforms Section  
  platformsContainer: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  platformsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  platformButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#475569',
    width: '48%',
  },
  platformText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },

  // Footer
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    backgroundColor: '#1e293b',
  },
  postButton: {
    borderRadius: 16,
  },
  postButtonDisabled: {
    opacity: 0.6,
  },
  postGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    flexDirection: 'row',
  },
  postButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: '#1e293b',
    borderRadius: 24,
    overflow: 'hidden',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#0f172a',
  },
  modalTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 4,
  },
  modalMediaContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#374151',
  },
  modalMediaPreview: {
    width: '100%',
    height: 300,
  },
  modalDescriptionContainer: {
    padding: 16,
  },
  modalDescriptionLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  modalDescription: {
    color: 'white',
    fontSize: 14,
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: 'row',
    padding: 16,
    justifyContent: 'center',
  },
  modalActionButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  modalActionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalActionText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  // AI Description Generation Overlay Styles
  aiOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiOverlayContent: {
    width: 280,
    borderRadius: 20,
    overflow: 'hidden',
  },
  aiOverlayGradient: {
    padding: 32,
    alignItems: 'center',
  },
  aiIconContainer: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 50,
  },
  aiOverlayTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 8,
  },
  aiOverlaySubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    marginBottom: 24,
  },
  aiLoadingContainer: {
    marginTop: 8,
  },

  // Multi-Photo Modal Styles
  multiPhotoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  multiPhotoModalContent: {
    width: '90%',
    maxWidth: 350,
    borderRadius: 24,
    overflow: 'hidden',
    elevation: 20,
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  multiPhotoModalGradient: {
    padding: 32,
    alignItems: 'center',
  },
  multiPhotoModalHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  multiPhotoIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  multiPhotoModalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 8,
  },
  multiPhotoModalSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
  },
  multiPhotoModalActions: {
    width: '100%',
    gap: 12,
  },
  multiPhotoActionButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  multiPhotoSecondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  multiPhotoActionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  multiPhotoActionText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
  },

  // Back Confirmation Modal Styles
  confirmationModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmationModalContent: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 24,
    overflow: 'hidden',
  },
  confirmationModalGradient: {
    padding: 24,
    alignItems: 'center',
  },
  confirmationModalHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  confirmationModalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  confirmationModalSubtitle: {
    fontSize: 16,
    color: '#cbd5e1',
    textAlign: 'center',
    lineHeight: 22,
  },
  confirmationModalActions: {
    width: '100%',
    gap: 12,
  },
  confirmationActionButton: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  confirmationActionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  confirmationActionText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
  },
  cancelButton: {
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
    borderWidth: 2,
    borderColor: 'rgba(148, 163, 184, 0.3)',
  },
  cancelButtonText: {
    color: '#cbd5e1',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 16,
  },
  
  // Comprehensive AI Styles
  comprehensiveAiSection: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#a855f7',
  },
  aiSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  aiSummaryTitle: {
    color: '#a855f7',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  aiDataItem: {
    backgroundColor: '#374151',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  aiDataLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  aiDataPreview: {
    color: '#d1d5db',
    fontSize: 12,
    lineHeight: 18,
  },
  comprehensiveAiButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
  },
  comprehensiveAiGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  comprehensiveAiButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
  },

  // Description Method Selection Overlay Styles
  descriptionMethodOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  descriptionMethodContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  descriptionMethodGradient: {
    padding: 25,
  },
  descriptionMethodHeader: {
    alignItems: 'center',
    marginBottom: 25,
  },
  descriptionMethodIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  descriptionMethodTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  descriptionMethodSubtitle: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 16,
    textAlign: 'center',
  },
  descriptionMethodOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
  },
  descriptionOptionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  descriptionOptionContent: {
    flex: 1,
  },
  descriptionOptionTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  descriptionOptionSubtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
  },
  textInputContainer: {
    marginTop: 10,
  },
  descriptionTextInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    padding: 15,
    color: 'white',
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 15,
  },
  textSubmitButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
  },
  textSubmitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  recordingIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    opacity: 1,
  },

  // Step-by-Step AI Progress Overlay Styles
  stepByStepOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  stepByStepContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  stepByStepGradient: {
    padding: 25,
  },
  stepByStepHeader: {
    alignItems: 'center',
    marginBottom: 25,
  },
  stepByStepIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  stepByStepTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  stepByStepSubtitle: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 16,
    textAlign: 'center',
  },
  stepsContainer: {
    marginBottom: 20,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  stepNumberActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  stepNumberInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  stepNumberText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  stepTitleActive: {
    color: 'white',
  },
  stepTitleInactive: {
    color: 'rgba(255, 255, 255, 0.5)',
  },
  stepDescription: {
    fontSize: 14,
  },
  stepDescriptionActive: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  stepDescriptionInactive: {
    color: 'rgba(255, 255, 255, 0.3)',
  },
  currentStepDescriptionContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    padding: 15,
    marginTop: 10,
  },
  currentStepDescriptionText: {
    color: 'white',
    fontSize: 14,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  // Review Overlay Styles
  reviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  reviewContent: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  reviewGradient: {
    padding: 25,
  },
  reviewHeader: {
    alignItems: 'center',
    marginBottom: 25,
  },
  reviewIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  reviewTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  reviewSubtitle: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 16,
    textAlign: 'center',
  },
  reviewSection: {
    marginBottom: 20,
  },
  reviewSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  reviewSectionTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  reviewContentBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
  },
  reviewContentText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 14,
    lineHeight: 20,
  },
  reviewDescriptionsContainer: {
    maxHeight: 200,
  },
  reviewDescriptionNumber: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  generateAIButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  generateAIButtonDisabled: {
    opacity: 0.7,
  },
  generateAIButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    paddingHorizontal: 20,
  },
  generateAIButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  reviewCloseButton: {
    alignItems: 'center',
    paddingVertical: 15,
    marginTop: 10,
  },
  reviewCloseButtonText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ReviewScreen;