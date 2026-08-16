/** Public client config — mirrors EXPO_PUBLIC_* from eas.json production. */

export const cognito = {
  region: process.env.NEXT_PUBLIC_AWS_COGNITO_REGION || "eu-west-2",
  userPoolId:
    process.env.NEXT_PUBLIC_AWS_USER_POOL_ID || "eu-west-2_ITX07Zvnt",
  clientId:
    process.env.NEXT_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID ||
    "4a7r115hllaedriqsjlsa00snj",
  domain:
    process.env.NEXT_PUBLIC_COGNITO_DOMAIN ||
    "eu-west-2itx07zvnt.auth.eu-west-2.amazoncognito.com",
};

export const firebaseWeb = {
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    "AIzaSyAScxM-7tnuD0532VhY6bvaXvoWVEyDSF8",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    "blyp-master.firebaseapp.com",
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "blyp-master",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    "blyp-master.firebasestorage.app",
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "929105034040",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
    "1:929105034040:web:3f725bb93e50e9d8bb9fcd",
};

export const liveServiceUrl = (
  process.env.NEXT_PUBLIC_LIVE_SERVICE_URL ||
  "https://blyp-live-service-innn3d7yqq-uc.a.run.app"
).replace(/\/+$/, "");

export const firebaseBridgeBaseUrl = (
  process.env.NEXT_PUBLIC_FIREBASE_BRIDGE_BASE_URL ||
  "https://us-central1-blyp-master.cloudfunctions.net"
).replace(/\/+$/, "");

export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://blyp.world"
).replace(/\/+$/, "");
