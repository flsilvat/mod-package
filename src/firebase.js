// Firebase initialisation.
// Config values come from environment variables (see .env.example / README.md).
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// A friendly heads-up if the project hasn't been configured yet.
if (!firebaseConfig.projectId) {
  console.warn(
    'Firebase is not configured. Copy .env.example to .env and add your ' +
      'project values, then restart the dev server. See README.md.'
  );
}

const app = initializeApp(firebaseConfig);

// The Firestore database handle — import this wherever you read/write data.
export const db = getFirestore(app);
