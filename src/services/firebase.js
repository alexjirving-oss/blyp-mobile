// This file should contain only JavaScript code for Firebase service initialization.
// Move Firestore security rules to a separate file, e.g., firestore.rules.

// Example Firebase service initialization:
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  // your Firebase config here
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth };