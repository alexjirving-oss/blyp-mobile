import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { firebaseWeb } from "./env";

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  app = getApps().length ? getApps()[0]! : initializeApp(firebaseWeb);
  return app;
}

export function getDb(): Firestore {
  if (db) return db;
  db = getFirestore(getFirebaseApp());
  return db;
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(getFirebaseApp());
  return auth;
}
