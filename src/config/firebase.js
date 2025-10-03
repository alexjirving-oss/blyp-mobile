import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyAScxM-7tnuD0532VhY6bvaXvoWVEyDSF8",
  authDomain: "blyp-master.firebaseapp.com",
  projectId: "blyp-master",
  storageBucket: "blyp-master.firebasestorage.app",
  messagingSenderId: "929105034040",
  appId: "1:929105034040:web:3f725bb93e50e9d8bb9fcd"
};

// Validate Firebase config
if (!firebaseConfig || !firebaseConfig.apiKey) {
  throw new Error('Firebase configuration is missing or invalid. Please check src/config/firebase.js');
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth with AsyncStorage persistence for React Native
let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
  });
} catch (e) {
  // If auth is already initialized, get the existing instance
  auth = getAuth(app);
}

// Initialize Firebase services
export { auth };
export const db = getFirestore(app);
export const storage = getStorage(app);

// Gemini API configuration
export const geminiApiKey = "AIzaSyB_keeUJQhLwK8fUlnDRDoZDuO4rreneqY"; // Add your Gemini API key here
export const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`;