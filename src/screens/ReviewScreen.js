import React, { useState, useEffect, useRef } from 'react';
import Icon from '../components/Icon';
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
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import UnifiedVideo from '../components/UnifiedVideo';
import { Audio } from 'expo-av';
import { COLORS } from '../styles/theme';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system/legacy';
import { db as firestore, auth, storage } from '../config/firebase';
import { serverTimestamp } from 'firebase/firestore';
import { firebaseNative } from '../config/firebase';
import { useAuth } from '../hooks/useCommon';
import { normalizeProfileCategories } from '../utils/profileCategories';
import { useHasAI, useEntitlement } from '../hooks/useEntitlement';
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';
import { uploadMediaToStorage } from '../utils/uploadMediaToStorage';
import { prepareMediaForUpload } from '../utils/prepareMediaForUpload';
import Toast from 'react-native-toast-message';
import BlypLogo from '../components/BlypLogo';
import aiService from '../services/aiService';
import speechToTextService from '../services/speechToTextService';
import geminiSpeechService from '../services/geminiSpeechService';
import mediaDescriptionService from '../services/mediaDescriptionService';
import { initialReachState } from '../services/blypReachClient';

/**
 * Android photo-picker / camera URIs are often short-lived content:// handles.
 * Copy into app cache immediately so AI polish + later Storage upload still work.
 */
async function persistLocalMediaAsset(asset) {
  if (!asset?.uri || typeof asset.uri !== 'string') return asset;
  const uri = asset.uri;

  // Durable file:// already — keep it.
  if (uri.startsWith('file://')) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info?.exists && Number(info.size || 0) > 0) return asset;
    } catch { /* copy below */ }
  }

  const isVideo = asset.type === 'video' || String(asset.mimeType || '').startsWith('video/');
  const isAudio = asset.type === 'audio' || String(asset.mimeType || '').startsWith('audio/');
  const ext = isVideo ? 'mp4' : isAudio ? 'm4a' : 'jpg';
  const dest = `${FileSystem.cacheDirectory}blyp-media-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  try {
    await FileSystem.copyAsync({ from: uri, to: dest });
    const info = await FileSystem.getInfoAsync(dest);
    if (!info?.exists || Number(info.size || 0) <= 0) {
      throw new Error('persist copy empty');
    }
    return { ...asset, uri: dest, localUri: dest };
  } catch (e) {
    console.warn('[MEDIA] persistLocalMediaAsset failed; keeping original URI', e?.message || e);
    return asset;
  }
}
import { COMPOSE_DRAFT_KEY } from '../components/CreatePostButton';
// Caption orchestrator (smart-merge Option B)
import { getPreviewCaption, freezeCaption } from '../../caption/orchestrator';
import { preparePostMetadata } from '../../upload/preparePostMetadata';

const ReviewScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { media, type, mode, transcript, source, entryPoint } = route.params || {};
  const { user: cognitoUser, uid, isAuthenticated, authReady } = useAuth();
  const entitlement = useEntitlement();
  const aiEntitled = useHasAI();

  // Premium AI conveniences (captions/hashtags/titles) gate. Core posting,
  // editing and voice-to-text for capture stay free; only the AI generation
  // extras require Plus. Returns true if allowed, else routes to Plans.
  const requireAI = () => {
    if (aiEntitled) return true;
    Alert.alert(
      'A Plus feature',
      'AI captions, titles and hashtags are part of Blyp Plus. You can still write and post normally on the free plan.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'See plans', onPress: () => navigation.navigate('Plans') },
      ],
    );
    return false;
  };

  const getDescribeTargetLabel = () => {
    // Prefer explicit route param when present
    if (type === 'video' || type === 'videos') return 'video';
    if (type === 'photos') return 'photos';
    if (type === 'photo') return 'photo';

    // Otherwise infer from the items
    const items = Array.isArray(mediaItems) ? mediaItems : [];
    if (items.length === 0) return 'media';
    const uniqueTypes = Array.from(new Set(items.map(m => m?.type).filter(Boolean)));
    if (uniqueTypes.length === 1) {
      const t = uniqueTypes[0];
      if (t === 'video') return items.length === 1 ? 'video' : 'videos';
      if (t === 'photo' || t === 'image') return items.length === 1 ? 'photo' : 'photos';
    }
    return 'media';
  };

  const explainTranscriptErrorToken = (token) => {
    const raw = typeof token === 'string' ? token.trim() : '';
    const upper = raw.toUpperCase();

    if (upper === '[NO_KEY]') {
      return {
        title: '🎤 Voice transcription unavailable',
        message: 'Missing EXPO_PUBLIC_GEMINI_API_KEY in this build',
      };
    }
    if (upper === '[READ_FAIL]') {
      return {
        title: '🎤 Could not read recording',
        message: 'Try again (or record a bit longer)',
      };
    }
    if (upper === '[NO_CANDIDATE]') {
      return {
        title: '🎤 Could not detect speech',
        message: 'Try speaking louder/longer, then release',
      };
    }
    if (upper.startsWith('[ERROR:')) {
      const inner = raw.slice('[ERROR:'.length, -1); // strip [ERROR: ... ]
      const innerUpper = inner.toUpperCase();
      if (innerUpper.includes('429') || innerUpper.includes('QUOTA') || innerUpper.includes('RATE_LIMIT')) {
        return {
          title: '🎤 AI busy',
          message: 'Voice describe hit a temporary AI limit. Wait a few seconds and try again, or type your description.',
        };
      }
      if (innerUpper.includes('403')) {
        return {
          title: '🎤 AI auth failed',
          message: 'Gemini key rejected (HTTP 403). Check key validity.',
        };
      }
      return {
        title: '🎤 Voice transcription unavailable',
        message: inner?.slice?.(0, 90) ? `Error: ${inner.slice(0, 90)}` : 'Type your description instead',
      };
    }

    return {
      title: '🎤 Voice transcription unavailable',
      message: 'Type your description instead',
    };
  };
  
  // Debug route params on screen initialization
  console.log('[POST][ENTRY] ReviewScreen opened', {
    entryPoint: entryPoint || 'unknown',
    mediaCount: media ? (Array.isArray(media) ? media.length : 1) : 0,
    type,
    mode,
    source,
    hasTranscript: !!transcript,
    authReady,
    isAuthenticated
  });
  
  // Store source in state to persist across re-renders
  const [sourceType, setSourceType] = useState(() => source);
  
  // Initialize mediaItems state - convert single media to array or use empty array
  const [mediaItems, setMediaItems] = useState(() => {
    if (media) {
      return Array.isArray(media) ? media : [media];
    }
    return [];
  });
  
  const [caption, setCaption] = useState(transcript || '');
  const [isUploading, setIsUploading] = useState(false);
  // Human-readable publish stage shown on the blocking upload overlay.
  const [uploadStatusText, setUploadStatusText] = useState('Preparing your content…');
  // Track if Firebase Web API key appears suspended (auth error pattern)
  const [firebaseSuspended, setFirebaseSuspended] = useState(false);
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
  const [voiceCaption, setVoiceCaption] = useState('');
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
  const [aiGeneratedCaptionState, setAiGeneratedCaptionState] = useState(null);
  const [generatedTitleState, setGeneratedTitleState] = useState(null);
  const [generatedHashtagsState, setGeneratedHashtagsState] = useState([]);
  const [profileCategories, setProfileCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [editedAfterAI, setEditedAfterAI] = useState(false);
  // AI caption variants the user can choose between (2-3 options)
  const [descriptionVariants, setDescriptionVariants] = useState([]);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  // Intent used to produce the current variants, so "regenerate" can reuse it
  const [variantIntent, setVariantIntent] = useState('');
  const [isRegeneratingVariants, setIsRegeneratingVariants] = useState(false);
  // Smart-merge caption state
  const [captionState, setCaptionState] = useState({
    photos: [],
    manualCaption: '',
    voiceCaption: '',
    aiCaptionsByPhotoId: {},
    aiGeneratedCaption: null,
    editedAfterAI: false,
    previewCaption: '',
    frozenCaption: undefined,
    source: 'none'
  });
  const [isGeneratingFromText, setIsGeneratingFromText] = useState(false);
  
  // UI State
  const [isManualDescriptionExpanded, setIsManualDescriptionExpanded] = useState(false);
  const [isCapturingMultiplePhotos, setIsCapturingMultiplePhotos] = useState(false);
  const [showMultiPhotoModal, setShowMultiPhotoModal] = useState(false);
  const [currentPhotoCount, setCurrentPhotoCount] = useState(0);
  const [shouldAutoTriggerStepByStep, setShouldAutoTriggerStepByStep] = useState(false);
  const scrollViewRef = useRef(null);

  // MAGIC PATH state: show an instant optimistic caption, then upgrade it in
  // place when the single multimodal AI call resolves.
  const [isPolishingCaption, setIsPolishingCaption] = useState(false);
  const [magicError, setMagicError] = useState(null);
  const magicRunIdRef = useRef(0);          // invalidates stale in-flight runs
  const magicUserTookOverRef = useRef(false); // user edited/picked → don't clobber
  const magicAutoStartedRef = useRef(false); // ambient AI once per compose session

  // Load this creator's profile category shelves for the compose picker.
  useEffect(() => {
    if (!uid || !firestore || typeof firestore.collection !== 'function') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const snap = await firestore.collection('users').doc(uid).get();
        const data = snap?.data?.() || {};
        if (cancelled) return;
        setProfileCategories(normalizeProfileCategories(data.profileCategories));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Initialize original caption when transcript changes
  useEffect(() => {
    if (transcript) {
      setOriginalCaption(transcript);
      setCaption(transcript);
    }
  }, [transcript]);

  // Keep captionState in sync with UI inputs and AI data
  // PRIORITY: editedAfterAI → aiGeneratedCaption → smart-merge (voice + photos)
  useEffect(() => {
    console.log('📋 Caption state update:', {
      editedAfterAI,
      hasAiGenerated: !!aiGeneratedCaptionState,
      manualDescriptionLength: manualDescription?.length || 0,
      voiceCaptionLength: voiceCaption?.length || 0
    });
    
    // Build photos list with stable ids using index
    const photos = (mediaItems || [])
      .filter((m) => m?.type === 'photo' || m?.type === 'image')
      .map((m, idx) => ({ id: String(idx) }));

    // Map AI per-photo descriptions to ids (for smart-merge fallback)
    const aiMap = {};
    photos.forEach((p, idx) => {
      const desc = mediaDescriptions?.[idx]?.description || mediaDescriptions?.[idx]?.text || mediaDescriptions?.[idx] || '';
      if (typeof desc === 'string' && desc.trim().length > 0) {
        aiMap[p.id] = desc.trim();
      }
    });

    const nextState = {
      photos,
      manualCaption: manualDescription || '',
      voiceCaption: voiceCaption || '',
      aiCaptionsByPhotoId: aiMap,
      aiGeneratedCaption: aiGeneratedCaptionState || null,
      editedAfterAI: editedAfterAI || false,
      frozenCaption: captionState.frozenCaption,
      source: captionState.source || 'none'
    };

    // Derive preview caption via orchestrator
    // getPreviewCaption respects priority: frozen → manual (if editedAfterAI) → aiGeneratedCaption → smart-merge
    const preview = getPreviewCaption(nextState);
    setCaptionState({ ...nextState, previewCaption: preview?.finalCaption ?? preview ?? '' });
  }, [mediaItems, manualDescription, voiceCaption, mediaDescriptions, aiGeneratedCaptionState, editedAfterAI]);
  
  // Frictionless path: never auto-open the description gate. Ambient Magic Path
  // runs once media lands (see generateMagicPost auto-start effect below).
  useEffect(() => {
    if (mediaItems.length > 0 && !overlayAlreadyShown) {
      setOverlayAlreadyShown(true);
      setShowDescriptionMethodOverlay(false);
      setShouldAutoTriggerStepByStep(false);
    }
  }, [mediaItems.length, overlayAlreadyShown]);
  
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
      (captionState.previewCaption || '').trim() !== '' ||
      manualDescription.trim() !== '' ||
      voiceCaption.trim() !== ''
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

      await firestore.collection('drafts').add(draftData);

      try {
        await AsyncStorage.setItem(
          COMPOSE_DRAFT_KEY,
          JSON.stringify({
            mediaItems: draftData.mediaItems,
            caption: draftData.caption || '',
            type: mediaItems.some((m) => m?.type === 'video') ? 'videos' : 'photos',
            source: sourceType || 'draft',
            savedAt: Date.now(),
          })
        );
      } catch (e) {
        console.warn('[POST] local draft cache failed', e?.message || e);
      }
      
      Toast.show({
        type: 'success',
        text1: 'Draft saved',
        text2: 'Resume it anytime from the Create sheet',
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
    AsyncStorage.removeItem(COMPOSE_DRAFT_KEY).catch(() => {});
    navigation.goBack();
  };

  const mediaCountRef = useRef(0);
  useEffect(() => {
    mediaCountRef.current = mediaItems.length;
  }, [mediaItems.length]);

  /** Mode entry (FAB → camera/library): cancel with no media → leave composer. */
  const exitIfEmptyModeCompose = () => {
    if (mediaCountRef.current > 0) return;
    if (mode === 'photo' || mode === 'video' || mode === 'library') {
      navigation.goBack();
    }
  };

  const togglePlatform = (platform) => {
    setSelectedPlatforms(prev => ({
      ...prev,
      [platform]: !prev[platform]
    }));
  };

  // Separate ref to track if we just completed step-by-step processing
  const justCompletedStepByStepRef = useRef(false);
  const prevMediaLenRef = useRef(0);

  // Preserve AI caption when adding more media. Re-polish only if the user
  // has not taken over editing (avoids wiping a good first caption).
  useEffect(() => {
    const prev = prevMediaLenRef.current;
    const next = mediaItems.length;
    prevMediaLenRef.current = next;
    if (next === 0) return;
    setOverlayAlreadyShown(true);
    setShowDescriptionMethodOverlay(false);
    if (next > prev && prev > 0 && !magicUserTookOverRef.current) {
      const note = (manualDescription || caption || '').trim();
      void generateMagicPost(note).catch((e) => {
        console.error('❌ re-polish after add-media failed', e);
      });
    }
  }, [mediaItems.length]);

  // Magic Path owns captions — do not run legacy per-photo auto-desc (quota + blocking modals).
  useEffect(() => {
    if (mediaItems.length === 0) return;
    setOverlayAlreadyShown(true);
    setShowDescriptionMethodOverlay(false);
  }, [mediaItems.length, sourceType]);

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

      // Do not preflight with testConnection — it adds a full AI round-trip and
      // often 429s before the real caption call even starts.
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
          text1: '🎤 Recording…',
          text2: 'Release to finish',
          position: 'top',
          visibilityTime: 1500,
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
        console.log('⚠️ stopVoiceDescription: audioUri null; providing manual input fallback instead of error');
        setIsTranscribing(false);
        Toast.show({
          type: 'info',
          text1: '🎤 No audio captured',
          text2: 'Type your description manually',
          position: 'bottom'
        });
        return;
      }

      // Use Gemini AI for speech transcription with timeout
      console.log('🤖 Using Gemini AI for speech transcription...');
      
      const transcriptionPromise = geminiSpeechService.transcribeAudio(audioUri);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Transcription timeout after 30 seconds')), 30000)
      );
      
      let transcript = await Promise.race([transcriptionPromise, timeoutPromise]);

      // GeminiSpeechService may return bracketed error tokens like [NO_KEY], [NO_CANDIDATE], [ERROR:...]
      const isErrorToken = typeof transcript === 'string' && /^\[[A-Z_]+(?::.*)?\]$/.test(transcript.trim());
      if (isErrorToken) {
        console.log('⚠️ Voice transcription returned error token; falling back to manual input', transcript);
        setIsTranscribing(false);
        const { title, message } = explainTranscriptErrorToken(transcript);
        Toast.show({
          type: 'info',
          text1: title,
          text2: message,
          position: 'bottom',
        });
        // Keep the overlay open and show text input
        setShowTextInput(true);
        return;
      }

      if (!transcript || /no clear speech/i.test(transcript)) {
        console.log('🌀 Low-confidence transcript; using placeholder text');
        transcript = 'Spoken description captured';
      }
      setVoiceCaption(transcript);

      console.log('📝 Voice transcript:', transcript);

      // Handle transcription result
      if (transcript && transcript.trim() !== '' && !/tap to type|audio recorded|no clear speech/i.test(transcript)) {
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
        
        // Only pre-fill the caption with raw voice IF we haven't already
        // generated an AI post caption. Once AI has run, voice should live
        // in voiceCaption but must not overwrite the AI description.
        setManualDescription(prev => {
          if (aiGeneratedCaptionState) {
            return prev;
          }
          return prev ? `${prev}\n\n${transcript}` : transcript;
        });
        setIsTranscribing(false);
        
        Toast.show({
          type: 'success',
          text1: '🎤 Voice input added!',
          text2: `"${transcript.slice(0, 30)}${transcript.length > 30 ? '...' : ''}"`,
          position: 'bottom',
        });
        
        // Auto-trigger step-by-step processing if recording was from description overlay
        if (isRecordingFromOverlay) {
          console.log('🎤 Voice input recorded from overlay - generating post (magic path)');
          console.log('🎤 Transcript to process:', transcript);
          setShowDescriptionMethodOverlay(false);
          // MAGIC PATH: instant draft + single multimodal upgrade.
          void generateMagicPost(transcript).catch((e) => {
            console.error('❌ generateMagicPost failed', e);
          });
          return;
        }
        
        // Only auto-trigger AI generation if NOT coming from camera with multiple photos
        // If coming from camera, trigger step-by-step processing now that voice is done
        // MAGIC PATH for every voice route: instant draft + single multimodal upgrade.
        setShouldAutoTriggerStepByStep(false);
        void generateMagicPost(transcript).catch((e) => {
          console.error('❌ generateMagicPost failed', e);
        });
      } else {
        console.log('🎤 Voice recording complete - using fallback placeholder');
        setIsTranscribing(false);
        // Pre-fill manual description with empty string, keep placeholder hidden
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
          // Instead of an error toast, quietly present the manual input already opened above
          console.log('ℹ️ Fallback: manual input shown instead of error toast');
          return;
        }
        
        // MAGIC PATH without voice: still produce a draft straight from the photos.
        if (!shouldAutoTriggerStepByStep) {
          void generateMagicPost('').catch((e) => {
            console.error('❌ generateMagicPost failed', e);
          });
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
      
      // MAGIC PATH: even if transcription failed, still produce a draft from photos.
      if (!shouldAutoTriggerStepByStep) {
        console.log('🔄 Voice processing failed, generating post from photos anyway');
        void generateMagicPost('').catch((e) => {
          console.error('❌ generateMagicPost failed', e);
        });
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
    if (!requireAI()) return;
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

  // Apply one of the generated caption variants as the active caption.
  const applyVariant = (index) => {
    const variant = descriptionVariants[index];
    if (!variant) return;

    // User explicitly chose an option — don't let an in-flight magic upgrade clobber it.
    magicUserTookOverRef.current = true;

    setSelectedVariantIndex(index);

    const description = variant.description || '';
    const title = variant.title || '';
    const hashtags = Array.isArray(variant.hashtags) ? variant.hashtags : [];

    // Feed the caption pipeline (treated as a fresh AI result, not a manual edit).
    setAiGeneratedCaptionState(description);
    setEditedAfterAI(false);
    setManualDescription(description);
    if (title) setGeneratedTitleState(title);
    if (hashtags.length > 0) {
      setGeneratedHashtagsState(hashtags);
      setGeneratedHashtags(hashtags);
    }

    // Keep legacy state in sync so existing UI / upload paths work unchanged.
    setAiCaption(description);
    setCaption(description);
    setGeneratedContent((prev) => ({
      ...(prev || {}),
      title: title || prev?.title || '',
      description,
      hashtags: hashtags.length > 0 ? hashtags : (prev?.hashtags || [])
    }));
  };

  // Shared: commit a variant result (from AI or fallback) into all caption state.
  // Stores the full option set, defaults to the first, and keeps legacy state in sync.
  // Returns true if at least one variant was committed.
  const commitVariantResult = (variantResult, intent) => {
    const variants = variantResult?.variants || [];
    if (variants.length === 0) return false;

    const primary = variants[0];
    const primaryHashtags = Array.isArray(primary.hashtags) ? primary.hashtags : [];
    const aiContent = {
      title: primary.title || variantResult.title || '',
      description: primary.description || '',
      hashtags: primaryHashtags
    };

    setDescriptionVariants(variants);
    setSelectedVariantIndex(0);
    if (typeof intent === 'string') setVariantIntent(intent);

    setAiGeneratedCaptionState(aiContent.description);
    setGeneratedTitleState(aiContent.title);
    setGeneratedHashtagsState(aiContent.hashtags);
    setEditedAfterAI(false);
    setManualDescription(aiContent.description);

    setGeneratedContent(aiContent);
    setAiCaption(aiContent.description);
    setCaption(aiContent.description);
    setGeneratedHashtags(aiContent.hashtags);
    setAiSuggestions(aiContent);
    setShowAiContent(true);
    setContentView('ai');
    return true;
  };

  // MAGIC PATH — "you speak, here's your post." Show an instant draft, then
  // upgrade it in place from a SINGLE multimodal AI call. No step-by-step
  // overlay, no artificial setTimeout delays: the post appears immediately and
  // gets better when the model returns.
  // opts.gate=false skips the Plus alert (used by ambient auto-start when
  // entitlement is already known true, or silent no-ops for free tier).
  const generateMagicPost = async (intent = '', opts = {}) => {
    const gate = opts?.gate !== false;
    if (gate && !requireAI()) return;
    if (!gate && !aiEntitled) return;

    const cleanIntent = (intent || '').trim();
    const runId = (magicRunIdRef.current += 1);
    magicUserTookOverRef.current = false;
    setMagicError(null);

    setUserRequestedAI(true);
    setVariantIntent(cleanIntent);

    // Land the user straight on the composer (close any open overlays).
    setShowDescriptionMethodOverlay(false);
    setShowStepByStepOverlay(false);
    setShowReviewOverlay(false);
    setShowMultiPhotoModal(false);
    setIsCapturingMultiplePhotos(false);
    setOverlayAlreadyShown(true);

    // 1) Instant optimistic draft so a usable post appears right away.
    const optimistic = mediaDescriptionService.getVariantFallback([], cleanIntent, 3);
    commitVariantResult(optimistic, cleanIntent);
    setIsPolishingCaption(true);

    Toast.show({
      type: 'info',
      text1: 'Writing your post…',
      text2: 'Polishing a caption from your media',
      position: 'bottom',
    });

    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 280, animated: true });
    }, 50);

    // 2) Upgrade in place with ONE multimodal call (collapses the per-photo loop).
    try {
      const result = await mediaDescriptionService.generatePostFromMedia(
        mediaItems,
        cleanIntent,
        { count: 3 }
      );

      // Ignore stale runs (a newer generateMagicPost started).
      if (magicRunIdRef.current !== runId) return;

      if (Array.isArray(result?.perPhotoDescriptions) && result.perPhotoDescriptions.length > 0) {
        setMediaDescriptions(result.perPhotoDescriptions);
      }

      if (result?.aiError) {
        setMagicError(String(result.aiError).slice(0, 120));
      }

      if (result?.variants?.length) {
        if (magicUserTookOverRef.current) {
          // User already edited / picked a variant — keep their choice, just
          // refresh the available options for "Regenerate".
          setDescriptionVariants(result.variants);
        } else {
          commitVariantResult(result, cleanIntent);
          if (!result?.aiError) {
            Toast.show({
              type: 'success',
              text1: 'Your post is ready',
              text2: 'Pick a caption or tweak it your way',
              position: 'bottom',
            });
          }
        }
        if (!result?.aiError) setMagicError(null);
      } else if (!result?.aiError) {
        setMagicError('Couldn’t polish — keep editing or post as-is');
      }
    } catch (e) {
      console.error('❌ generateMagicPost failed', e);
      if (magicRunIdRef.current === runId) {
        setMagicError(e?.message ? String(e.message).slice(0, 90) : 'Couldn’t polish — keep editing or post as-is');
      }
    } finally {
      if (magicRunIdRef.current === runId) setIsPolishingCaption(false);
    }
  };

  // Re-roll the caption options without restarting the whole flow,
  // reusing the same intent + the existing per-photo descriptions.
  const regenerateVariants = async () => {
    try {
      setIsRegeneratingVariants(true);
      const result = await mediaDescriptionService.generatePostDescriptionVariants(
        mediaDescriptions || [],
        variantIntent || '',
        { count: 3 }
      );
      const ok = commitVariantResult(result, variantIntent);
      if (!ok) {
        const fallback = mediaDescriptionService.getVariantFallback(
          mediaDescriptions || [],
          variantIntent || '',
          3
        );
        commitVariantResult(fallback, variantIntent);
      }
      Toast.show({
        type: 'success',
        text1: '🔄 New options ready',
        text2: 'Fresh caption choices below',
        position: 'bottom',
      });
    } catch (error) {
      console.error('❌ Failed to regenerate variants:', error);
      Toast.show({
        type: 'error',
        text1: 'Could not regenerate',
        text2: 'Please try again',
        position: 'bottom',
      });
    } finally {
      setIsRegeneratingVariants(false);
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

      // Build contextual prompt combining voice (PRIMARY) + photo descriptions
      const hasVoice = voiceInput && voiceInput.trim().length > 0;
      const hasPhotoDescriptions = mediaDescriptions && mediaDescriptions.length > 0;
      
      let contextPrompt = '';
      if (hasVoice && hasPhotoDescriptions) {
        // VOICE + PHOTO: treat voice as PRIMARY
        contextPrompt = `Create a SHORT social media post emphasizing the user's voice message, with photos as visual context.

🗣️ User's Voice (PRIMARY): "${voiceInput}"

📸 Photo Context:
${mediaDescriptions.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}

INSTRUCTIONS:
- Write PRIMARILY about what the user said
- Use photo descriptions only as context/validation
- Make it natural and authentic
- Keep it SHORT and catchy
- Return JSON: {title, description, hashtags}`;
        console.log('🎤📸 Using CONTEXTUAL path (voice PRIMARY + photos)');
      } else if (hasPhotoDescriptions && !hasVoice) {
        contextPrompt = `Create a social media post from these photo descriptions:

${mediaDescriptions.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}

Write a natural, engaging caption with catchy title. Return JSON: {title, description, hashtags}.`;
        console.log('📸 Using CONTEXTUAL path (photos only)');
      } else if (hasVoice && !hasPhotoDescriptions) {
        contextPrompt = `Create a social media post from this message:

"${voiceInput}"

Write naturally with catchy title. Return JSON: {title, description, hashtags}.`;
        console.log('🎤 Using CONTEXTUAL path (voice only)');
      } else {
        throw new Error('No voice or photo descriptions available');
      }

      // Generate 2-3 selectable caption variants by fusing every per-photo
      // description with the user's stated intent (voiceInput).
      const variantResult = await mediaDescriptionService.generatePostDescriptionVariants(
        mediaDescriptions || [],
        voiceInput || '',
        { count: 3 }
      );

      console.log('✅ AI variants generated:', variantResult);

      const committed = commitVariantResult(variantResult, voiceInput || '');
      if (committed) {
        const optionCount = variantResult?.variants?.length || 0;
        Toast.show({
          type: 'success',
          text1: '🤖 AI captions ready!',
          text2: optionCount > 1
            ? `Pick from ${optionCount} options below`
            : 'Your caption has been generated',
          position: 'bottom',
        });
      } else {
        throw new Error('No AI content generated');
      }

    } catch (error) {
      console.error('❌ AI content generation failed:', error);
      
      // Use multi-variant fallback so the selector still offers choices offline.
      const fallbackResult = mediaDescriptionService.getVariantFallback(
        mediaDescriptions || [],
        voiceInput || '',
        3
      );
      const fallbackVariants = fallbackResult?.variants || [];
      const fallbackContent = fallbackVariants.length > 0
        ? { title: fallbackResult.title || 'My Story', description: fallbackVariants[0].description, hashtags: fallbackVariants[0].hashtags }
        : { title: 'My Story', description: (voiceInput || '') + ' 📱✨', hashtags: ['story', 'personal', 'voice'] };

      console.log('🔄 Using personalized fallback with user input:', { voiceInput, fallbackContent });

      setDescriptionVariants(fallbackVariants);
      setSelectedVariantIndex(0);

      // Store fallback in caption pipeline
      setAiGeneratedCaptionState(fallbackContent.description || '');
      setGeneratedTitleState(fallbackContent.title || '');
      setGeneratedHashtagsState(fallbackContent.hashtags || []);
      setEditedAfterAI(false);
      setManualDescription(fallbackContent.description || '');
      
      // Keep legacy state
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
      
      // Generate 2-3 selectable variants from all photo descriptions (no explicit user intent here).
      const variantResult = await mediaDescriptionService.generatePostDescriptionVariants(
        mediaDescriptions,
        '',
        { count: 3 }
      );
      const _variants = (variantResult?.variants && variantResult.variants.length > 0)
        ? variantResult.variants
        : mediaDescriptionService.getVariantFallback(mediaDescriptions, '', 3).variants;
      setDescriptionVariants(_variants);
      setSelectedVariantIndex(0);
      setVariantIntent('');
      const aiContent = {
        title: _variants[0].title || variantResult?.title || '',
        description: _variants[0].description || '',
        hashtags: _variants[0].hashtags || []
      };

      if (aiContent) {
        // Store AI-generated content in new state variables for caption pipeline
        setAiGeneratedCaptionState(aiContent.description || '');
        setGeneratedTitleState(aiContent.title || '');
        setGeneratedHashtagsState(aiContent.hashtags || []);
        setEditedAfterAI(false);
        setManualDescription(aiContent.description || '');
        
        // Keep legacy state for backward compatibility
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
      console.log('🎯 GALLERY FUNCTION CALLED - addMediaFromLibrary starting...');

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm?.granted && perm?.accessPrivileges !== 'limited') {
        Alert.alert('Permission needed', 'Allow Photos/Videos access so Blyp can attach and upload media.');
        return;
      }
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection: true,
        quality: 0.8,
        // Cap capture length so uploads stay TikTok-ish in size/time.
        videoMaxDuration: 60,
      });

      if (!result.canceled && result.assets?.length > 0) {
        // 🔥 SET SOURCE TO GALLERY for proper overlay handling
        setSourceType('gallery');
        console.log('📸 Source set to gallery for', result.assets.length, 'items');
        
        // Add new media to existing mediaItems (persist URIs first)
        const mapped = result.assets.map(asset => ({
          ...asset,
          type: asset.type === 'video' ? 'video' : 'photo'
        }));
        const newMediaItems = [];
        for (const item of mapped) {
          newMediaItems.push(await persistLocalMediaAsset(item));
        }
        
        console.log('📸 Adding media from library:', newMediaItems.length, 'items');
        console.log('📸 New media types:', newMediaItems.map(item => item.type));
        setMediaItems(prevItems => {
          const updatedItems = [...prevItems, ...newMediaItems];
          console.log('📸 Total media items now:', updatedItems.length);
          return updatedItems;
        });
      } else if (result.canceled) {
        exitIfEmptyModeCompose();
      }
    } catch (error) {
      console.error('Error selecting media from library:', error);
      Alert.alert('Error', 'Failed to access media library');
      exitIfEmptyModeCompose();
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
    console.log('📝 Continue with photos — composer + ambient Magic Path');
    setShowMultiPhotoModal(false);
    setIsCapturingMultiplePhotos(false);
    setShowDescriptionMethodOverlay(false);
    setOverlayAlreadyShown(true);
    if (!magicAutoStartedRef.current && mediaItems.length > 0) {
      magicAutoStartedRef.current = true;
      void generateMagicPost('').catch((e) => {
        console.error('❌ generateMagicPost failed', e);
      });
    }
  };

  // Initialize step-by-step processing immediately for voice input
  const initializeStepByStepProcessingWithVoice = async (voiceCaption = null) => {
    try {
      console.log('🚀 Initializing step-by-step processing with voice input:', voiceCaption);
      
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
      if (voiceCaption) {
        steps.push({
          title: 'Voice Input',
          description: voiceCaption.length > 60 ? voiceCaption.slice(0, 60) + '...' : voiceCaption,
          fullDescription: voiceCaption,
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
      await processPhotosStepByStepWithVoice(voiceCaption);
      
    } catch (error) {
      console.error('❌ Failed to initialize immediate step-by-step processing:', error);
      Alert.alert('Error', 'Failed to start AI processing');
      setShowStepByStepOverlay(false);
    }
  };

  // Initialize step-by-step processing for multiple photos
  const initializeStepByStepProcessing = async () => {
    try {
      console.log('🚀 Initializing step-by-step AI processing for', mediaItems.length, 'media items');
      
      // Prepare steps for each photo
      const steps = [];
      mediaItems.forEach((media, index) => {
        const label = media?.type === 'video' ? 'Video' : 'Photo';
        steps.push({
          title: `${label} ${index + 1} - Generating Description`,
          description: `Creating AI description for ${label.toLowerCase()} ${index + 1}`,
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
      setCurrentStepDescription(`Analyzing item 1 of ${mediaItems.length}...`);
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
  const processPhotosStepByStepWithVoice = async (voiceCaption = null) => {
    try {
      console.log('🚀 Starting step-by-step processing with voice transcript:', voiceCaption);
      
      // Initialize steps for photos + voice + AI generation
      const steps = [];
      mediaItems.forEach((media, index) => {
        const label = media?.type === 'video' ? 'Video' : 'Photo';
        steps.push({
          title: `${label} ${index + 1}`,
          description: `Analyzing ${label.toLowerCase()} ${index + 1}...`,
          completed: false
        });
      });
      
      // Add voice step
      steps.push({
        title: 'Voice Input',
        description: voiceCaption ? 'Processing voice description...' : 'Waiting for voice input...',
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
      setCurrentStepDescription(`Analyzing item 1 of ${mediaItems.length}...`);
      setShowStepByStepOverlay(true);
      
      const descriptions = [];
      
      // Process each photo
      for (let i = 0; i < mediaItems.length; i++) {
        const media = mediaItems[i];
        console.log(`🔍 Processing item ${i + 1}/${mediaItems.length}`, { type: media?.type });
        
        // Update current step
        setCurrentStep(i);
        setCurrentStepDescription(`Analyzing item ${i + 1} of ${mediaItems.length}...`);
        
        // Generate description for this photo (may return null when AI is unavailable)
        const rawDescription = await mediaDescriptionService.generateMediaDescription(media);
        const description = rawDescription || mediaDescriptionService.getFallbackDescription(media, i);
        descriptions.push(description);
        
        // Update step to show completion
        setAiSteps(prev => prev.map((step, index) => (
          index === i ? { ...step, completed: true, description: description.slice(0, 60) + '...' } : step
        )));
        
        // Small delay to show the completion
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Move to voice step and complete it if we have transcript
      const voiceStepIndex = mediaItems.length;
      setCurrentStep(voiceStepIndex);
      
      if (voiceCaption) {
        setCurrentStepDescription('Processing voice description...');
        
        // Update voice step to show the actual transcript
        setAiSteps(prev => prev.map((step, index) => 
          index === voiceStepIndex ? { ...step, completed: true, description: voiceCaption } : step
        ));
        
        // Small delay to show the voice step
        await new Promise(resolve => setTimeout(resolve, 1200));
        
        // Complete the final step with AI generation
        await completeStepByStepProcessing(voiceCaption, descriptions);
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
        console.log(`🔍 Processing item ${i + 1}/${mediaItems.length}`, { type: media?.type });
        
        // Update current step
        setCurrentStep(i);
        setCurrentStepDescription(`Analyzing item ${i + 1} of ${mediaItems.length}...`);
        
        // Generate description for this photo (may return null when AI is unavailable)
        const rawDescription = await mediaDescriptionService.generateMediaDescription(media);
        const description = rawDescription || mediaDescriptionService.getFallbackDescription(media, i);
        descriptions.push(description);
        
        // Update step to show completion
        setAiSteps(prev => prev.map((step, index) => (
          index === i ? { ...step, completed: true, description: description.slice(0, 60) + '...' } : step
        )));
        
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
      let _variants = null;
      try {
        const variantResult = await mediaDescriptionService.generatePostDescriptionVariants(
          descriptions,
          voiceContext,
          { count: 3 }
        );
        if (variantResult?.variants?.length) {
          _variants = variantResult.variants;
          aiContent = {
            title: _variants[0].title || variantResult.title || '',
            description: _variants[0].description || '',
            hashtags: _variants[0].hashtags || []
          };
        }
        console.log('✅ AI generation successful');
      } catch (aiError) {
        console.log('⚠️ AI generation failed, using smart fallback:', aiError.message);
      }
      if (!_variants) {
        // Smart fallback that still offers multiple distinct options.
        const fb = mediaDescriptionService.getVariantFallback(descriptions, voiceContext, 3);
        _variants = fb.variants;
        aiContent = {
          title: _variants[0].title || fb.title || '',
          description: _variants[0].description || '',
          hashtags: _variants[0].hashtags || []
        };
      }
      setDescriptionVariants(_variants);
      setSelectedVariantIndex(0);
      setVariantIntent(voiceContext);
      
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
  const completeStepByStepProcessing = async (voiceCaption, photoDescriptions) => {
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
        voiceInput: voiceCaption,
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
    if (!requireAI()) return;
    try {
      console.log('🚀 User clicked Generate AI Post button');
      
      // Update review overlay to show generating state
      setReviewData(prev => ({ ...prev, isGeneratingAI: true }));
      
      // Determine what inputs we have
      const hasVoice = reviewData.voiceInput && reviewData.voiceInput.trim().length > 0;
      const hasPhotoDescriptions = reviewData.photoDescriptions && reviewData.photoDescriptions.length > 0;
      
      let contextPrompt = '';
      
      if (hasVoice && hasPhotoDescriptions) {
        // PRIMARY CASE: Voice + Photo Descriptions - VOICE IS PRIMARY
        contextPrompt = `Create a SHORT social media post emphasizing the user's voice message, with photos as visual context.

🗣️ User's Voice (PRIMARY): "${reviewData.voiceInput}"

📸 Photo Context:
${reviewData.photoDescriptions.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}

INSTRUCTIONS:
- Write PRIMARILY about what the user said
- Use photos only as context/validation
- Make it natural and authentic, like a real person posting
- Generate a SHORT CATCHY TITLE (50 characters max)
- Return JSON with: title, description, hashtags`;
        console.log('🎤📸 Using CONTEXTUAL path (voice PRIMARY + photos)');
      } else if (hasPhotoDescriptions && !hasVoice) {
        // Photo descriptions only
        contextPrompt = `Create a social media post from these photo descriptions:

${reviewData.photoDescriptions.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}

Create a natural, engaging caption with a catchy title (50 chars max). Return JSON with: title, description, hashtags.`;
        console.log('📸 Using CONTEXTUAL path (photos only)');
      } else if (hasVoice && !hasPhotoDescriptions) {
        // Voice only
        contextPrompt = `Create a social media post from this user message:

"${reviewData.voiceInput}"

Write a natural, engaging caption with a catchy title (50 chars max). Return JSON with: title, description, hashtags.`;
        console.log('🎤 Using CONTEXTUAL path (voice only)');
      } else {
        throw new Error('No voice or photo descriptions available');
      }
      
      // Generate 2-3 selectable caption variants (consistent across the app).
      const _intent = reviewData.voiceInput || '';
      const _descs = reviewData.photoDescriptions || [];
      const variantResult = await mediaDescriptionService.generatePostDescriptionVariants(
        _descs,
        _intent,
        { count: 3 }
      );
      const _variants = (variantResult?.variants && variantResult.variants.length > 0)
        ? variantResult.variants
        : mediaDescriptionService.getVariantFallback(_descs, _intent, 3).variants;
      setDescriptionVariants(_variants);
      setSelectedVariantIndex(0);
      setVariantIntent(_intent);
      const aiContent = {
        title: _variants[0].title || variantResult?.title || '',
        description: _variants[0].description || '',
        hashtags: _variants[0].hashtags || []
      };

      // Apply the AI content (SINGLE SOURCE OF TRUTH)
      console.log('✅ AI post generated successfully:', aiContent.description);
      
      setMediaDescriptions(reviewData.photoDescriptions);
      
      // Update caption pipeline state with AI-generated description
      setAiGeneratedCaptionState(aiContent.description || '');
      setGeneratedTitleState(aiContent.title || '');
      setGeneratedHashtagsState(aiContent.hashtags || []);
      setManualDescription(aiContent.description || ''); // Pre-fill TextInput
      setEditedAfterAI(false); // Mark as NOT edited
      
      // Keep legacy state for backward compatibility
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

      // If AI isn't available (missing Gemini key, quota, etc), don't attempt step-by-step AI.
      // Still allow posting with the user's description.
      if (!aiService.isAvailable()) {
        Toast.show({
          type: 'info',
          text1: 'AI unavailable',
          text2: 'Using your description without AI',
          position: 'bottom',
        });
        return;
      }

      // MAGIC PATH: instant draft from the typed intent + photos, upgraded in place.
      await generateMagicPost(descriptionText);
      
    } catch (error) {
      console.error('❌ Failed to generate post from text:', error);
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
    
    // Reset the auto-trigger flag and generate a draft straight from the photos.
    setShouldAutoTriggerStepByStep(false);
    
    try {
      // MAGIC PATH: no description needed — build the post from the photos.
      await generateMagicPost('');
    } catch (error) {
      console.error('❌ Failed to generate post:', error);
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

          const isErrorToken = typeof transcript === 'string' && /^\[[A-Z_]+(?::.*)?\]$/.test(transcript.trim());
          if (isErrorToken) {
            const { title, message } = explainTranscriptErrorToken(transcript);
            Toast.show({
              type: 'info',
              text1: title,
              text2: message,
              position: 'bottom',
            });
            setShowTextInput(true);
            return;
          }
          
          if (transcript && transcript.trim()) {
            setVoiceCaption(transcript);
            setOriginalCaption(transcript);
            setCaption(transcript);
            
            // Add to accumulated voice inputs
            setAccumulatedVoiceInputs(prev => [...prev, transcript]);
            setAllContextualData(prev => ({
              ...prev,
              voiceInputs: [...prev.voiceInputs, transcript]
            }));
            
            // Only pre-fill the caption with raw voice IF we haven't already
            // generated an AI post caption.
            if (!aiGeneratedCaptionState) {
              setManualDescription(transcript);
            }
            
            // MAGIC PATH: instant draft + single multimodal upgrade after voice input.
            console.log('🤖 Generating post (magic path) after voice description');
            setUserRequestedAI(true);
            void generateMagicPost(transcript).catch((e) => {
              console.error('❌ generateMagicPost failed', e);
            });
            
          } else {
            Toast.show({
              type: 'info',
              text1: '🎤 Could not understand audio',
              text2: 'Try again, or type your description instead',
              position: 'bottom',
            });
          }
        } catch (transcriptionError) {
          console.error('❌ Transcription failed:', transcriptionError);
          Toast.show({
            type: 'error',
            text1: '🎤 Transcription failed',
            text2: transcriptionError?.message ? String(transcriptionError.message).slice(0, 90) : 'Type your description instead',
            position: 'bottom',
          });
          setShowTextInput(true);
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

  // Take Photo — land straight on the composer (no multi-photo gate).
  const handleTakePhoto = async () => {
    try {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (!cam?.granted) {
        Alert.alert('Permission needed', 'Allow Camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const newMediaItem = await persistLocalMediaAsset({
          ...result.assets[0],
          type: 'photo'
        });
        console.log('📷 Taking photo - new media item:', { type: newMediaItem.type, uri: newMediaItem.uri?.substring(0, 50) + '...' });
        setSourceType((prev) => prev || 'camera');
        setShowMultiPhotoModal(false);
        setIsCapturingMultiplePhotos(false);
        setOverlayAlreadyShown(true);
        setMediaItems((prevItems) => [...prevItems, newMediaItem]);
      } else if (result.canceled) {
        exitIfEmptyModeCompose();
      }
    } catch (error) {
      console.error('Camera error:', error);
      Alert.alert('Error', 'Failed to take photo');
      setIsCapturingMultiplePhotos(false);
      exitIfEmptyModeCompose();
    }
  };

  // Take Video handler  
  const handleTakeVideo = async () => {
    try {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (!cam?.granted) {
        Alert.alert('Permission needed', 'Allow Camera access to record a video.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 0.8,
        videoMaxDuration: 60,
      });

      if (!result.canceled && result.assets[0]) {
        const newMediaItem = await persistLocalMediaAsset({
          ...result.assets[0],
          type: 'video'
        });
        setSourceType((prev) => prev || 'camera');
        setShowMultiPhotoModal(false);
        setOverlayAlreadyShown(true);
        setMediaItems((prevItems) => [...prevItems, newMediaItem]);
      } else if (result.canceled) {
        exitIfEmptyModeCompose();
      }
    } catch (error) {
      console.error('Video camera error:', error);
      Alert.alert('Error', 'Failed to record video');
      exitIfEmptyModeCompose();
    }
  };

  const modeLaunchRef = useRef(false);
  useEffect(() => {
    if (modeLaunchRef.current || mediaItems.length > 0) return;
    if (mode === 'photo') {
      modeLaunchRef.current = true;
      setSourceType((prev) => prev || 'camera');
      handleTakePhoto().catch(() => {});
    } else if (mode === 'video') {
      modeLaunchRef.current = true;
      setSourceType((prev) => prev || 'camera');
      handleTakeVideo().catch(() => {});
    } else if (mode === 'library') {
      modeLaunchRef.current = true;
      setSourceType('gallery');
      addMediaFromLibrary().catch(() => {});
    }
  }, [mode, mediaItems.length]);

  // Ambient Magic Path: once media is present, auto-caption for entitled users
  // (photos + videos — videos use a thumbnail frame). Free users still see the
  // explicit "Generate with AI" CTA below; we do not auto-paywall them.
  useEffect(() => {
    if (mediaItems.length === 0) return;
    if (magicAutoStartedRef.current) return;
    if (route?.params?.resumeDraft) {
      // Resumed drafts already have a caption; don't clobber unless empty.
      if ((caption || '').trim().length > 0) {
        magicAutoStartedRef.current = true;
        return;
      }
    }
    // Wait until entitlement has resolved so we don't flash AI for free users
    // or skip it for trial users still loading.
    if (!entitlement) return undefined;
    if (!entitlement.capabilities?.ai) {
      magicAutoStartedRef.current = true;
      setOverlayAlreadyShown(true);
      return undefined;
    }

    magicAutoStartedRef.current = true;
    setOverlayAlreadyShown(true);
    setShowDescriptionMethodOverlay(false);
    setShowMultiPhotoModal(false);
    const t = setTimeout(() => {
      void generateMagicPost('', { gate: false }).catch((e) => {
        console.error('❌ ambient generateMagicPost failed', e);
      });
    }, 150);
    return () => clearTimeout(t);
  }, [mediaItems.length, entitlement]);

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

  const uploadMedia = async (mediaUri, mediaType, fbUser, statusCtx = {}) => {
    if (!fbUser || !fbUser.uid) {
      throw new Error('User not authenticated (no Firebase UID)');
    }
    const kind = String(mediaType || 'photo').toLowerCase();
    const itemLabel = statusCtx.itemLabel || 'media';
    console.log('📤 Starting media upload...');
    console.log('📤 Media URI:', mediaUri);
    console.log('📤 Media type:', kind);
    console.log('📤 Using Firebase UID:', fbUser.uid);

    const fileExtension =
      kind === 'video' ? 'mp4' : kind === 'audio' ? 'm4a' : 'jpg';
    const fileName = `${kind}-${Date.now()}.${fileExtension}`;
    const filePath = `users/${fbUser.uid}/media/${fileName}`;
    const contentType =
      kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/m4a' : 'image/jpeg';

    // Compress large videos before Storage (TikTok-style client prep). Soft-fails.
    let uploadUri = mediaUri;
    if (kind === 'video') {
      try {
        setUploadStatusText(`Compressing ${itemLabel}…`);
        const prepared = await prepareMediaForUpload(mediaUri, 'video', {
          onProgress: (p) => {
            const raw = Number(p) || 0;
            // Compressor may report 0–1 or 0–100 depending on native build.
            const pct = Math.min(100, Math.round(raw <= 1 ? raw * 100 : raw));
            setUploadStatusText(`Compressing ${itemLabel}… ${pct}%`);
          },
        });
        if (prepared?.uri) uploadUri = prepared.uri;
        console.log('📤 Media prep', {
          compressed: !!prepared?.compressed,
          originalBytes: prepared?.originalBytes,
          compressedBytes: prepared?.compressedBytes,
          reason: prepared?.reason,
        });
      } catch (prepErr) {
        console.warn('📤 Media prep skipped', prepErr?.message || prepErr);
      }
    }

    setUploadStatusText(`Uploading ${itemLabel}…`);
    const uploadedPromise = uploadMediaToStorage({
      localUri: uploadUri,
      storagePath: filePath,
      contentType,
      timeoutMs: kind === 'video' ? 180000 : 90000,
      onProgress: (pct) => {
        setUploadStatusText(`Uploading ${itemLabel}… ${pct}%`);
      },
    });

    let thumbnailUrl = null;

    // TikTok-style: don't serialize thumb after the full video upload — generate
    // + upload thumb in parallel with the main media so publish isn't 2x wait.
    let thumbWork = Promise.resolve(null);
    if (kind === 'video') {
      thumbWork = (async () => {
        try {
          console.log('🎬 Generating video thumbnail (parallel with upload)...');
          const thumbnailPromise = VideoThumbnails.getThumbnailAsync(mediaUri, {
            time: 0,
            quality: 0.55,
          });
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Thumbnail generation timeout')), 5000)
          );
          const { uri: thumbnailUri } = await Promise.race([thumbnailPromise, timeoutPromise]);
          const thumbnailFileName = `thumbnail-${Date.now()}.jpg`;
          const thumbPath = `users/${fbUser.uid}/thumbnails/${thumbnailFileName}`;
          const thumbUploaded = await uploadMediaToStorage({
            localUri: thumbnailUri,
            storagePath: thumbPath,
            contentType: 'image/jpeg',
            timeoutMs: 30000,
          });
          return thumbUploaded.downloadURL;
        } catch (error) {
          console.error('⚠️ Failed to generate thumbnail:', error);
          return null;
        }
      })();
    }

    const [uploaded, thumbResult] = await Promise.all([uploadedPromise, thumbWork]);
    const downloadURL = uploaded.downloadURL;
    thumbnailUrl = thumbResult;
    console.log('📤 Upload complete, download URL:', downloadURL);
    if (thumbnailUrl) console.log('✅ Thumbnail uploaded:', thumbnailUrl);

    let normalizedType = 'image';
    if (kind === 'video') normalizedType = 'video';
    else if (kind === 'audio') normalizedType = 'audio';

    return {
      url: downloadURL,
      type: normalizedType,
      thumbnail: thumbnailUrl || null,
    };
  };

  const handlePost = async () => {
    const hasMedia = Array.isArray(mediaItems) && mediaItems.length > 0;
    if (!caption.trim() && !hasMedia && (!media || !media.uri)) {
      Alert.alert('Error', 'Please add a caption or media');
      return;
    }

    // Release builds must have Firebase Auth established before Storage/Firestore.
    // In DEV we sometimes run with open rules, so we allow skipping.
    if (__DEV__) {
      console.log('[POST][AUTH] DEV: skipping strict Firebase auth gate.');
    } else {
      try {
        if (!uid) {
          Alert.alert('Auth Error', 'Missing user id (uid). Please sign out and sign back in.');
          return;
        }
        await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
      } catch (e) {
        const code = e?.code || e?.name || 'FIREBASE_AUTH_ERROR';
        const msg = e?.message || String(e);
        const status = typeof e?.status === 'number' ? ` (HTTP ${e.status})` : '';
        console.error('[POST][AUTH] Firebase auth bridge not ready', { code, msg, status, detail: e?.detail });
        Alert.alert('Auth Error', `Cannot post until Firebase auth is ready.\n\n${code}${status}\n${msg}`);
        return;
      }
    }
    
    // Use Firebase user if available, otherwise create mock user with Cognito UID
    let fbUser = auth.currentUser;
    if (!fbUser && cognitoUser && __DEV__) {
      // Create mock Firebase user with Cognito UID for DEV-OPEN rules
      fbUser = { 
        uid: cognitoUser.getUsername?.() || uid,
        displayName: null,
        email: null,
        photoURL: null,
        providerId: 'cognito'
      };
    } else if (!fbUser) {
      // No Firebase user and no Cognito user
      console.error('❌ No user available for posting');
      Alert.alert('Auth Error', 'You must be logged in to post.');
      return;
    }
    const appUser = fbUser; // Use Firebase user if available, or Cognito-based mock user
    
    console.log('🚀 Starting post creation...');
    console.log('🚀 Current user (fb||cognito):', appUser);
    console.log('🚀 User ID:', fbUser?.uid || cognitoUser?.getUsername?.());
    console.log('🚀 Caption:', caption);
    console.log('🚀 Media:', media);
    
    if (firebaseSuspended) {
      Alert.alert('Posting Disabled', 'Firebase key suspended. Rotate key before posting.');
      return;
    }
    if (!appUser) {
      Alert.alert('Error', 'No Firebase user; cannot post');
      return;
    }

    setIsUploading(true);
    setUploadStatusText('Preparing your content…');
    
    try {
      let uploadedMedia = [];
      
      if (mediaItems && mediaItems.length > 0) {
        console.log(`📤 Starting upload process for ${mediaItems.length} media items...`);
        
        for (let i = 0; i < mediaItems.length; i++) {
          const mediaItem = mediaItems[i];
          if (mediaItem.uri) {
            try {
              const itemLabel =
                mediaItems.length > 1
                  ? `${i + 1}/${mediaItems.length}`
                  : mediaItem.type === 'video'
                    ? 'video'
                    : 'photo';
              console.log(`📤 Uploading media ${i + 1}/${mediaItems.length}... Type: ${mediaItem.type}`);
              let mediaData;
              try {
                mediaData = await uploadMedia(mediaItem.uri, mediaItem.type, fbUser, { itemLabel });
              } catch (firstErr) {
                console.warn(`📤 Media ${i + 1} first attempt failed, retrying once…`, firstErr?.message);
                setUploadStatusText(`Retrying ${itemLabel}…`);
                mediaData = await uploadMedia(mediaItem.uri, mediaItem.type, fbUser, { itemLabel });
              }
              uploadedMedia.push(mediaData);
            } catch (uploadError) {
              // Expanded diagnostics for storage/unknown issues
              const errObj = uploadError || {};
              const customData = errObj.customData || errObj._customData || null;
              const reason = String(errObj.message || errObj.code || 'unknown error').slice(0, 180);
              const diag = {
                index: i + 1,
                code: errObj.code,
                name: errObj.name,
                message: errObj.message,
                customData,
                customDataJson: customData ? JSON.stringify(customData).slice(0, 500) : null,
                serverResponse: errObj.serverResponse || errObj.response || (errObj.error && errObj.error.serverResponse),
                authUid: auth?.currentUser?.uid || null,
                cognitoUid: uid || null,
                stack: errObj.stack ? errObj.stack.split('\n').slice(0, 3) : null
              };
              console.error(`📤 Media upload ${i + 1} failed`, diag);
              console.log('📤 Retry/skip decision prompt will appear');
              
              // Ask user if they want to continue without this media
              const continueWithoutMedia = await new Promise((resolve) => {
                Alert.alert(
                  'Upload Failed',
                  `Media upload ${i + 1} failed:\n${reason}\n\nContinue without this file?`,
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
  const hasAudio = uploadedMedia.some(m => m.type === 'audio');
  const postType = hasVideo ? 'video' : hasImage ? 'image' : hasAudio ? 'audio' : 'text';
      
      // Get primary media URLs for compatibility
      const primaryMedia = uploadedMedia[0];
  const videoUrl = hasVideo ? primaryMedia?.url : null;
  const imageUrl = hasImage ? primaryMedia?.url : null;
  const audioUrl = hasAudio ? primaryMedia?.url : null;

      // Extract thumbnail URL from the primary media
      const thumbnailUrl = uploadedMedia[0]?.thumbnail;
      
      const appUserId = String(uid || fbUser?.uid || '').trim() || 'anonymous';
      const displayName =
        fbUser?.displayName ||
        cognitoUser?.attributes?.name ||
        cognitoUser?.attributes?.preferred_username ||
        cognitoUser?.getUsername?.() ||
        'Anonymous';
      const photoURL = fbUser?.photoURL || cognitoUser?.attributes?.picture || null;
      // Freeze caption before preparing metadata
      const frozen = freezeCaption(captionState);
      setCaptionState(frozen);

      // Prepare upload metadata with frozen caption
      const metadata = preparePostMetadata({
        captionState: frozen,
        photos: (uploadedMedia || []).filter(m => m.type === 'image').map((m, idx) => ({ id: String(idx) }))
      });

      // Single source of truth for caption
      const baseCaption = metadata.caption || '';
      
      const postData = {
        userId: appUserId,
        username: displayName,
        userPhotoURL: photoURL,
        title: (generatedTitleState && generatedTitleState.trim()) || baseCaption.substring(0, 80) || 'New Post',
        transcript: baseCaption,
        description: baseCaption,
        caption: baseCaption,
        tags: extractHashtags(baseCaption),
        hashtags: generatedHashtagsState || [],
        categoryId: selectedCategoryId || null,
        emoji: uploadedMedia.length > 0 ? '📸' : '💭',
        media: uploadedMedia,
        type: postType, // Add post type
  videoUrl: videoUrl, // Add direct video URL
  imageUrl: imageUrl, // Add direct image URL
  audioUrl: audioUrl, // Add direct audio URL
        thumbnail: thumbnailUrl || null, // Guard against undefined (Firestore rejects undefined)
        user: {
          username: displayName,
          avatar: photoURL
        },
        likes: 0, // Add likes field
        comments: 0, // Add comments field  
        shares: 0, // Add shares field
        sharedTo: Object.keys(selectedPlatforms).filter(k => selectedPlatforms[k]),
        date: serverTimestamp(),
        likeCount: 0,
        commentCount: 0,
        viewCount: 0,
        views: 0,
        giftCoins: 0,
        giftCount: 0,
        coinsReceived: 0,
        // Earn-your-reach: every new post enters audition with a fair, equal start.
        reach: initialReachState(),
      };

      console.log('=== SAVING POST TO FIREBASE ===');
      console.log('Post data:', postData);

      setUploadStatusText('Publishing…');
      const docRef = await firestore.collection('posts').add(postData);
      
      console.log('✅ Post saved successfully with ID:', docRef.id);
      
      // Stop upload overlay and navigate immediately
      setIsUploading(false);

      try {
        await AsyncStorage.removeItem(COMPOSE_DRAFT_KEY);
      } catch {
        // non-blocking
      }
      
      Toast.show({
        type: 'success',
        text1: 'Post created!',
        text2: 'Your post is now live',
        position: 'bottom',
      });
      
      // Navigate immediately - user doesn't need to wait. Land on the For You
      // feed (not the HomeBase hub) so the user can actually see posted content (P7.7).
      navigation.navigate('MainTabs', { screen: 'Home', params: { focusFeed: true } });
      
      // Generate AI comments in background (non-blocking, fire-and-forget)
      console.log('🤖 Starting background AI comment generation for post:', docRef.id);
      generateAIComments(postData)
        .then(aiComments => {
          if (aiComments && aiComments.length > 0) {
            console.log(`✅ Generated ${aiComments.length} AI comments in background`);
            setGeneratedComments(aiComments);
            // Optionally: Update Firestore post with AI comment IDs for future retrieval
          }
        })
        .catch(err => {
          console.warn('[POST][AI] Background AI comment generation failed', { 
            postId: docRef.id, 
            error: err?.message 
          });
          // Fail silently - post is already created successfully
        });
      
    } catch (error) {
      const code = error?.code || error?.name || 'POST_FAILED';
      const msg = error?.message || String(error);
      const status = typeof error?.status === 'number' ? ` (HTTP ${error.status})` : '';
      console.error('Error posting:', { code, msg, status, error });
      Alert.alert('Error', `Failed to post.\n\n${code}${status}\n${msg}`);
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
      
      // Build contextual prompt using SAME structure as other entry points
      const hasVoice = voiceInputs && voiceInputs.length > 0;
      const hasManualText = manualText && manualText.trim().length > 0;
      const hasPhotoDescriptions = photoDescriptions && photoDescriptions.length > 0;
      
      // Combine all voice inputs into single string
      const combinedVoice = voiceInputs.join(' ');
      
      let contextPrompt = '';
      if ((hasVoice || hasManualText) && hasPhotoDescriptions) {
        // VOICE/TEXT + PHOTO: treat voice/text as PRIMARY
        const primaryMessage = hasVoice ? combinedVoice : manualText;
        contextPrompt = `Create a SHORT social media post emphasizing the user's message, with photos as visual context.

🗣️ User's Message (PRIMARY): "${primaryMessage}"

📸 Photo Context:
${photoDescriptions.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}

INSTRUCTIONS:
- Write PRIMARILY about what the user said
- Use photo descriptions only as context/validation
- Make it natural and authentic
- Keep it SHORT and catchy
- Return JSON: {title, description, hashtags}`;
        console.log('🎤📸 Using CONTEXTUAL path (voice/text PRIMARY + photos)');
      } else if (hasPhotoDescriptions && !hasVoice && !hasManualText) {
        // Photos only
        contextPrompt = `Create a social media post from these photo descriptions:

${photoDescriptions.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}

Write a natural, engaging caption with catchy title. Return JSON: {title, description, hashtags}.`;
        console.log('📸 Using CONTEXTUAL path (photos only)');
      } else if ((hasVoice || hasManualText) && !hasPhotoDescriptions) {
        // Voice/text only
        const primaryMessage = hasVoice ? combinedVoice : manualText;
        contextPrompt = `Create a social media post from this message:

"${primaryMessage}"

Write naturally with catchy title. Return JSON: {title, description, hashtags}.`;
        console.log('🎤 Using CONTEXTUAL path (voice/text only)');
      } else {
        throw new Error('No voice, text, or photo descriptions available');
      }
      
      // The user's stated intent (voice or typed text) drives the caption;
      // photo descriptions are supporting context.
      const intent = hasVoice ? combinedVoice : (hasManualText ? manualText : '');

      // Generate 2-3 selectable caption variants from ALL photo descriptions + intent.
      const variantResult = await mediaDescriptionService.generatePostDescriptionVariants(
        photoDescriptions || [],
        intent,
        { count: 3 }
      );

      const committed = commitVariantResult(variantResult, intent);
      if (committed) {
        const optionCount = variantResult?.variants?.length || 0;
        console.log('✅ AI post generated successfully:', variantResult?.variants?.[0]?.description);
        Toast.show({
          type: 'success',
          text1: '🤖 AI captions ready!',
          text2: optionCount > 1
            ? `Pick from ${optionCount} options below`
            : 'Voice + photos combined into one great post',
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
      <Icon  
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
          <Icon  name="arrow-back" size={24} color="#ffffff"  />
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
        {/* Top Action Buttons — add media only (voice is hold-to-talk below) */}
        <View style={styles.topActionButtons}>
          <TouchableOpacity 
            style={styles.topActionButton}
            onPress={handleTakePhoto}
          >
            <LinearGradient
              colors={['#1A1A1F', '#141418']}
              style={styles.topActionGradient}
            >
              <Icon  name="camera" size={24} color="white"  />
              <Text style={styles.topActionText}>Take Photo</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.topActionButton}
            onPress={handleTakeVideo}
          >
            <LinearGradient
              colors={['#1A1A1F', '#141418']}
              style={styles.topActionGradient}
            >
              <Icon  name="videocam" size={24} color="white"  />
              <Text style={styles.topActionText}>Take Video</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.topActionButton}
            onPress={handleMediaLibraryPress}
          >
            <LinearGradient
              colors={['#1A1A1F', '#141418']}
              style={styles.topActionGradient}
            >
              <Icon  name="images" size={24} color="white"  />
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
                      <UnifiedVideo
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
                      <Icon  name="close-circle" size={16} color="#FF4444"  />
                    </TouchableOpacity>
                  </View>
                  
                  {/* AI Description */}
                  <View style={styles.descriptionContainer}>
                    <Text style={styles.mediaDescription} numberOfLines={2}>
                      {mediaDescriptions[index] || '—'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Primary AI entry — always visible once media is on the composer */}
        {mediaItems.length > 0 && (
          <View style={styles.aiPrimarySection}>
            <TouchableOpacity
              style={[
                styles.aiPrimaryButton,
                (isPolishingCaption || mediaItems.length === 0) && styles.enhanceButtonDisabled,
              ]}
              onPress={() => {
                const note = (manualDescription || caption || voiceCaption || '').trim();
                void generateMagicPost(note).catch((e) => {
                  console.error('❌ Generate with AI failed', e);
                });
              }}
              disabled={isPolishingCaption || mediaItems.length === 0}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={isPolishingCaption ? ['#666', '#666'] : ['#00D2BE', '#00A89E']}
                style={styles.aiPrimaryGradient}
              >
                {isPolishingCaption ? (
                  <ActivityIndicator size="small" color="#0A0A0C" />
                ) : (
                  <Icon name="sparkles" size={22} color="#0A0A0C" />
                )}
                <Text style={styles.aiPrimaryButtonText}>
                  {isPolishingCaption ? 'Writing with AI…' : 'Generate with AI'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
            <Text style={styles.aiPrimaryHint}>
              Captions, title and hashtags from your media — or hold the mic and describe it.
            </Text>
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
              colors={isRecording ? ['#ff4444', '#ff6b6b'] : ['#00D2BE', '#00A89E']}
              style={styles.voiceButtonGradient}
            >
              {isTranscribing ? (
                <ActivityIndicator size="large" color="white" />
              ) : (
                <Icon  
                  name={isRecording ? "stop" : "mic"} 
                  size={32} 
                  color={isRecording ? "white" : "#0A0A0C"} 
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

        {/* Caption editor — always available (AI fills it; user can type anytime) */}
        {!generatedContent && (
          <View style={styles.manualDescriptionSection}>
            <Text style={styles.sectionLabel}>Caption</Text>
            <View style={styles.manualTextContainer}>
              <TextInput
                style={styles.manualTextInput}
                placeholder="Write a caption, or wait for AI…"
                placeholderTextColor="#888"
                value={manualDescription}
                onChangeText={(text) => {
                  magicUserTookOverRef.current = true;
                  setManualDescription(text);
                  setCaption(text);
                  setAllContextualData(prev => ({
                    ...prev,
                    manualText: text
                  }));
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
                disabled={!manualDescription.trim() || isGeneratingFromText || mediaItems.length === 0}
              >
                <LinearGradient
                  colors={!manualDescription.trim() ? ['#666', '#666'] : ['#00D2BE', '#00A89E']}
                  style={styles.enhanceFromTextGradient}
                >
                  {isGeneratingFromText ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Icon  name="sparkles" size={20} color={manualDescription.trim() ? "#0A0A0C" : "white"}  />
                      <Text style={[styles.enhanceFromTextButtonText, manualDescription.trim() && { color: '#0A0A0C' }]}>Enhance with AI</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Optional text intent when AI content already showing */}
        {generatedContent && (
        <View style={styles.manualDescriptionSection}>
          <TouchableOpacity 
            style={styles.collapsibleHeader}
            onPress={() => setIsManualDescriptionExpanded(!isManualDescriptionExpanded)}
          >
            <Text style={styles.sectionLabel}>Add more context:</Text>
            <Icon  
              name={isManualDescriptionExpanded ? "chevron-up" : "chevron-down"} 
              size={20} 
              color="#9ca3af" 
             />
          </TouchableOpacity>
          
          {isManualDescriptionExpanded && (
            <View style={styles.manualTextContainer}>
              <TextInput
                style={styles.manualTextInput}
                placeholder="Extra notes for AI polish…"
                placeholderTextColor="#888"
                value={manualDescription}
                onChangeText={(text) => {
                  setManualDescription(text);
                  setAllContextualData(prev => ({
                    ...prev,
                    manualText: text
                  }));
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
                  colors={!manualDescription.trim() ? ['#666', '#666'] : ['#00D2BE', '#00A89E']}
                  style={styles.enhanceFromTextGradient}
                >
                  {isGeneratingFromText ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Icon  name="sparkles" size={20} color={manualDescription.trim() ? "#0A0A0C" : "white"}  />
                      <Text style={[styles.enhanceFromTextButtonText, manualDescription.trim() && { color: '#0A0A0C' }]}>Enhance with AI</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </View>
        )}

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
              <Icon  name="sparkles" size={18} color={contentView === 'ai' ? "#0A0A0C" : "#00D2BE"}  />
              <Text style={[styles.toggleButtonText, contentView === 'ai' && styles.activeToggleText]}>AI Enhanced</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.contentToggleButton, contentView === 'original' && styles.activeToggleButton]}
              onPress={() => {
                setContentView('original');
                setCaption(originalCaption);
              }}
            >
              <Icon  name="document-text" size={18} color={contentView === 'original' ? "white" : "#6b7280"}  />
              <Text style={[styles.toggleButtonText, contentView === 'original' && styles.activeToggleText]}>Original</Text>
            </TouchableOpacity>
          </View>
          
          {/* Voice Transcript Box - Only shown in Original mode */}
          {(contentView === 'original' && voiceCaption) && (
            <View style={styles.transcriptContainer}>
              <Text style={styles.transcriptLabel}>🎤 Audio Recorded</Text>
              <TextInput
                style={styles.transcriptInput}
                value={captionState.previewCaption || ''}
                onChangeText={(text) => {
                  // User started editing — don't let an in-flight magic upgrade clobber it.
                  magicUserTookOverRef.current = true;
                  // Track manual edits after AI generation
                  if (aiGeneratedCaptionState && aiGeneratedCaptionState.trim().length > 0) {
                    setEditedAfterAI(true);
                  }
                  
                  // Update manual description (feeds into captionState)
                  setManualDescription(text);
                  
                  // Keep legacy state
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
                  colors={['#00D2BE', '#00A89E']}
                  style={styles.enhanceAiGradient}
                >
                  <Icon  name="sparkles" size={20} color="#0A0A0C"  />
                  <Text style={[styles.enhanceAiButtonText, { color: '#0A0A0C' }]}>Enhance with AI</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
          
          {/* Editable Caption - Hide in Original mode when transcript exists */}
          {!(contentView === 'original' && voiceCaption) && (
            <View style={styles.aiDescriptionBox}>
              {/* AI Caption Variants Selector */}
              {contentView === 'ai' && descriptionVariants.length >= 1 && (
                <View style={styles.variantSelectorContainer}>
                  <View style={styles.variantSelectorHeader}>
                    <Text style={styles.variantSelectorLabel}>
                      {isPolishingCaption
                        ? '✍️ Polishing your caption…'
                        : descriptionVariants.length > 1
                          ? `Choose a caption (${descriptionVariants.length} options)`
                          : 'AI caption'}
                    </Text>
                    <TouchableOpacity
                      style={styles.regenerateButton}
                      onPress={regenerateVariants}
                      disabled={isRegeneratingVariants}
                      activeOpacity={0.7}
                    >
                      {isRegeneratingVariants ? (
                        <ActivityIndicator size="small" color="#00D2BE" />
                      ) : (
                        <Icon name="refresh" size={14} color="#00D2BE" />
                      )}
                      <Text style={styles.regenerateButtonText}>
                        {isRegeneratingVariants ? 'Regenerating…' : 'Regenerate'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {descriptionVariants.map((variant, index) => {
                    const isSelected = index === selectedVariantIndex;
                    return (
                      <TouchableOpacity
                        key={`variant-${index}`}
                        activeOpacity={0.8}
                        style={[styles.variantCard, isSelected && styles.variantCardSelected]}
                        onPress={() => applyVariant(index)}
                      >
                        <View style={[styles.variantRadio, isSelected && styles.variantRadioSelected]}>
                          {isSelected && <Icon name="checkmark" size={14} color="#0A0A0C" />}
                        </View>
                        <View style={styles.variantBody}>
                          {!!variant.title && (
                            <Text
                              style={[styles.variantTitle, isSelected && styles.variantTitleSelected]}
                              numberOfLines={1}
                            >
                              {variant.title}
                            </Text>
                          )}
                          <Text
                            style={[styles.variantText, isSelected && styles.variantTextSelected]}
                            numberOfLines={4}
                          >
                            {variant.description}
                          </Text>
                          {Array.isArray(variant.hashtags) && variant.hashtags.length > 0 && (
                            <Text style={styles.variantHashtags} numberOfLines={1}>
                              {variant.hashtags.map((h) => `#${h}`).join(' ')}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

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
                      setGeneratedTitleState(text);
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
                value={manualDescription || ''}
                onChangeText={(text) => {
                  // User started editing — don't let an in-flight magic upgrade clobber it.
                  magicUserTookOverRef.current = true;
                  // Track manual edits after AI generation
                  if (aiGeneratedCaptionState && aiGeneratedCaptionState.trim().length > 0) {
                    setEditedAfterAI(true);
                  }
                  
                  // Update manual description (this feeds into captionState)
                  setManualDescription(text);
                  
                  // Keep legacy state for backward compatibility
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

            {/* Profile category shelf (optional) */}
            {profileCategories.length > 0 ? (
              <View style={styles.hashtagContainer}>
                <Text style={styles.hashtagLabel}>Profile category</Text>
                <View style={styles.hashtagList}>
                  <TouchableOpacity
                    style={[styles.hashtagChip, !selectedCategoryId && styles.categoryChipActive]}
                    onPress={() => setSelectedCategoryId(null)}
                  >
                    <Text style={[styles.hashtagText, !selectedCategoryId && styles.categoryChipTextActive]}>
                      None
                    </Text>
                  </TouchableOpacity>
                  {profileCategories.map((cat) => {
                    const active = selectedCategoryId === cat.id;
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[styles.hashtagChip, active && styles.categoryChipActive]}
                        onPress={() => setSelectedCategoryId(cat.id)}
                      >
                        <Text style={[styles.hashtagText, active && styles.categoryChipTextActive]}>
                          {cat.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* Generated Hashtags */}
            {Array.isArray(generatedHashtags) && generatedHashtags.length > 0 && (
              <View style={styles.hashtagContainer}>
                <Text style={styles.hashtagLabel}>Generated Hashtags:</Text>
                <View style={styles.hashtagList}>
                  {generatedHashtags.filter(tag => tag && typeof tag === 'string').map((tag, index) => (
                    <TouchableOpacity key={index} style={styles.hashtagChip}>
                      <LinearGradient
                        colors={['#00D2BE', '#00D2BE', '#00A89E']}
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
          </View>
        )}

        {/* Media Preview */}

        {/* Action Buttons — always available while composing */}
        <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleMediaLibraryPress}
            >
              <Icon  name="images" size={20} color="#9ca3af"  />
              <Text style={styles.actionButtonText}>Add Media</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                handleTakePhoto().catch(() => {});
              }}
            >
              <Icon name="camera" size={20} color="#9ca3af" />
              <Text style={styles.actionButtonText}>Add Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                const note = (manualDescription || caption || '').trim();
                void generateMagicPost(note).catch((e) => {
                  console.error('❌ polish generateMagicPost failed', e);
                });
              }}
              disabled={isPolishingCaption || mediaItems.length === 0}
            >
              <Icon name="sparkles" size={20} color="#00D2BE" />
              <Text style={[styles.actionButtonText, { color: '#00D2BE' }]}>
                {isPolishingCaption ? 'Polishing…' : 'Polish AI'}
              </Text>
            </TouchableOpacity>
          </View>

        {/* External share row removed — not implemented; platforms still unused. */}

        {/* Bottom Spacer */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Post Button — AI polish never blocks publish */}
      <View style={styles.footer}>
        {isPolishingCaption || magicError ? (
          <View style={styles.magicStatusChip}>
            {isPolishingCaption ? (
              <>
                <ActivityIndicator size="small" color="#00D2BE" style={{ marginRight: 8 }} />
                <Text style={styles.magicStatusText}>Writing caption…</Text>
              </>
            ) : (
              <>
                <Icon name="alert-circle-outline" size={16} color="#FBBF24" />
                <Text style={[styles.magicStatusText, { marginLeft: 8, color: '#FBBF24' }]} numberOfLines={2}>
                  {magicError}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    magicAutoStartedRef.current = true;
                    void generateMagicPost(variantIntent || '').catch(() => {});
                  }}
                  style={{ marginLeft: 10 }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ color: '#00D2BE', fontWeight: '700', fontSize: 13 }}>Retry</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : null}
        <TouchableOpacity
          style={[styles.postButton, isUploading && styles.postButtonDisabled]}
          onPress={handlePostPress}
          disabled={isUploading}
        >
          <LinearGradient
            colors={isUploading ? ['#6b7280', '#6b7280'] : ['#00D2BE', '#00D2BE', '#00A89E']}
            style={styles.postGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {isUploading ? (
              <>
                <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                <Text style={styles.postButtonText}>Posting...</Text>
              </>
            ) : (
              <Text style={[styles.postButtonText, { color: '#0A0A0C' }]}>Post</Text>
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
                    <Icon  name="close" size={24} color="white"  />
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
                    <UnifiedVideo
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
                      <Icon  name="trash" size={20} color="white"  />
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
              colors={['#1C1C22', '#161619', '#141418']}
              style={styles.aiOverlayGradient}
            >
              <View style={styles.aiIconContainer}>
                <Icon  name="sparkles" size={48} color="#00D2BE"  />
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
                <Icon  name="create" size={48} color="white"  />
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
              colors={['#1C1C22', '#161619', '#141418']}
              style={styles.aiOverlayGradient}
            >
              <View style={styles.aiIconContainer}>
                <Icon  name="cloud-upload" size={48} color="#00D2BE"  />
              </View>
              <Text style={styles.aiOverlayTitle}>Uploading Your Post</Text>
              <Text style={styles.aiOverlaySubtitle}>{uploadStatusText || 'Preparing your content…'}</Text>
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
              colors={['#1C1C22', '#161619', '#141418']}
              style={styles.aiOverlayGradient}
            >
              <View style={styles.aiIconContainer}>
                <Icon  name="sparkles" size={48} color="#00D2BE"  />
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
              colors={['#1C1C22', '#161619', '#141418']}
              style={styles.stepByStepGradient}
            >
              {/* Header */}
              <View style={styles.stepByStepHeader}>
                <View style={styles.stepByStepIconContainer}>
                  <Icon  name="sparkles" size={32} color="#00D2BE"  />
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
                      step.isVoice && { backgroundColor: '#00D2BE' }
                    ]}>
                      {step.isVoice ? (
                        index < currentStep ? (
                          <Icon  name="checkmark" size={16} color="#0A0A0C"  />
                        ) : index === currentStep ? (
                          <ActivityIndicator size="small" color="#0A0A0C" />
                        ) : (
                          <Icon  name="mic" size={14} color="#0A0A0C"  />
                        )
                      ) : (
                        index < currentStep ? (
                          <Icon  name="checkmark" size={16} color="white"  />
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
                          step.isVoice && { fontStyle: 'italic', color: '#00D2BE' }
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
              colors={['#1C1C22', '#161619', '#141418']}
              style={styles.reviewGradient}
            >
              {/* Header */}
              <View style={styles.reviewHeader}>
                <View style={styles.reviewIconContainer}>
                  <Icon  name="document-text" size={32} color="#00D2BE"  />
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
                    <Icon  name="mic" size={20} color="white"  />
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
                    <Icon  name="images" size={20} color="white"  />
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
                      <Icon  name="sparkles" size={20} color="white" style={{ marginRight: 8 }}  />
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
                  <Icon  name="chatbubble-ellipses" size={32} color="white"  />
                </View>
                <Text style={styles.descriptionMethodTitle}>Add Description</Text>
                <Text style={styles.descriptionMethodSubtitle}>
                  How would you like to describe your {getDescribeTargetLabel()}?
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
                  <Icon  
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
                  <Icon  name="hand-left" size={20} color="rgba(255,255,255,0.7)"  />
                )}
              </TouchableOpacity>

              {/* Text Input Option */}
              <TouchableOpacity
                style={styles.descriptionMethodOption}
                onPress={handleTextDescription}
              >
                <View style={styles.descriptionOptionIconContainer}>
                  <Icon  name="create" size={24} color="#3b82f6"  />
                </View>
                <View style={styles.descriptionOptionContent}>
                  <Text style={styles.descriptionOptionTitle}>Type Description</Text>
                  <Text style={styles.descriptionOptionSubtitle}>Write your description</Text>
                </View>
                <Icon  name="chevron-forward" size={20} color="rgba(255,255,255,0.7)"  />
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
                    <Icon  name="arrow-forward-circle" size={24} color="#10b981"  />
                  </View>
                  <View style={styles.descriptionOptionContent}>
                    <Text style={styles.descriptionOptionTitle}>Continue Without Description</Text>
                    <Text style={styles.descriptionOptionSubtitle}>Process photos as-is</Text>
                  </View>
                  <Icon  name="chevron-forward" size={20} color="rgba(255,255,255,0.7)"  />
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
              colors={['#1C1C22', '#161619', '#141418']}
              style={styles.multiPhotoModalGradient}
            >
              {/* Header with camera icon */}
              <View style={styles.multiPhotoModalHeader}>
                <View style={styles.multiPhotoIconContainer}>
                  <Icon  name="camera" size={32} color="#00D2BE"  />
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
                    <Icon  name="camera-outline" size={24} color="white"  />
                    <Text style={styles.multiPhotoActionText}>Take Another Photo</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.multiPhotoActionButton, styles.multiPhotoSecondaryButton]}
                  onPress={handleContinueWithPost}
                >
                  <View style={styles.multiPhotoActionContent}>
                    <Icon  name="checkmark-circle-outline" size={24} color="white"  />
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
              colors={['#141418', '#27272E', '#3F3F46']}
              style={styles.confirmationModalGradient}
            >
              {/* Header */}
              <View style={styles.confirmationModalHeader}>
                <Icon  name="warning-outline" size={48} color="#f59e0b"  />
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
                    <Icon  name="bookmark-outline" size={24} color="white"  />
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
                    <Icon  name="trash-outline" size={24} color="white"  />
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
    backgroundColor: COLORS.pageBackground,
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
    borderBottomColor: '#141418',
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
    borderWidth: 1,
    borderColor: '#26262C',
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
  aiPrimarySection: {
    marginBottom: 16,
  },
  aiPrimaryButton: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  aiPrimaryGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  aiPrimaryButtonText: {
    color: '#0A0A0C',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  aiPrimaryHint: {
    marginTop: 8,
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  aiVoiceSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#27272E',
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
    backgroundColor: COLORS.surface,
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
    backgroundColor: '#0A0A0C',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#27272E',
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
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#26262C',
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  aiTitle: {
    color: '#00D2BE',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  contentToggleContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceAlt,
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
    backgroundColor: '#00D2BE',
  },
  toggleButtonText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  activeToggleText: {
    color: '#0A0A0C',
  },
  transcriptContainer: {
    backgroundColor: COLORS.surface,
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
    backgroundColor: '#0A0A0C',
    borderRadius: 8,
    padding: 12,
    color: '#ffffff',
    fontSize: 16,
    minHeight: 80,
    maxHeight: 120,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#27272E',
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
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  variantSelectorContainer: {
    marginBottom: 16,
  },
  variantSelectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  variantSelectorLabel: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  regenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(203,251,69,0.4)',
    backgroundColor: 'rgba(203,251,69,0.08)',
    marginLeft: 8,
  },
  regenerateButtonText: {
    color: '#00D2BE',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 5,
  },
  variantCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  variantCardSelected: {
    borderColor: '#00D2BE',
    backgroundColor: 'rgba(203,251,69,0.08)',
  },
  variantRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 1,
  },
  variantRadioSelected: {
    borderColor: '#00D2BE',
    backgroundColor: '#00D2BE',
  },
  variantBody: {
    flex: 1,
  },
  variantTitle: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 3,
  },
  variantTitleSelected: {
    color: '#ffffff',
  },
  variantText: {
    color: '#d1d5db',
    fontSize: 14,
    lineHeight: 20,
  },
  variantTextSelected: {
    color: '#ffffff',
  },
  variantHashtags: {
    color: '#00D2BE',
    fontSize: 12,
    marginTop: 6,
    opacity: 0.85,
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
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  categoryChipActive: {
    backgroundColor: '#00D2BE',
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
  categoryChipTextActive: {
    color: '#0A0A0C',
  },
  useAiButton: {
    backgroundColor: '#00D2BE',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  useAiButtonText: {
    color: '#0A0A0C',
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
    backgroundColor: COLORS.surface,
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
    backgroundColor: COLORS.surface,
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
    backgroundColor: COLORS.surface,
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
    backgroundColor: COLORS.surface,
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
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#00D2BE',
  },
  enhanceButtonText: {
    color: '#00D2BE',
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
    backgroundColor: COLORS.surface,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3F3F46',
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
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3F3F46',
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
    borderTopColor: '#27272E',
    backgroundColor: COLORS.surface,
  },
  magicStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#1C1C22',
    borderWidth: 1,
    borderColor: '#27272E',
  },
  magicStatusText: {
    flex: 1,
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '600',
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
    backgroundColor: COLORS.surface,
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
    backgroundColor: '#0A0A0C',
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
    backgroundColor: COLORS.surface,
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
    shadowColor: '#000000',
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
    color: '#D4D4D8',
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
    color: '#D4D4D8',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 16,
  },
  
  // Comprehensive AI Styles
  comprehensiveAiSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#26262C',
  },
  aiSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  aiSummaryTitle: {
    color: '#00D2BE',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  aiDataItem: {
    backgroundColor: COLORS.surface,
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