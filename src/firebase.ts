import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

// Browser authentication only. Attendance reads/writes go through the server;
// no browser SDK path can silently maintain a second attendance store.
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
