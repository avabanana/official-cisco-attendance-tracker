import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { type User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth } from '../firebase';

interface FirebaseContextType {
  user: User | null;
  authReady: boolean;
  isAdmin: boolean;
  isFirebaseAvailable: boolean;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  signInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  syncFullStoreToFirestore: () => Promise<{ success: boolean; count: number; error?: string }>;
}
const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);
export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isFirebaseAvailable, setIsFirebaseAvailable] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  useEffect(() => onAuthStateChanged(auth, current => { setUser(current); setAuthReady(true); }), []);
  // Compatibility name retained for the existing admin component. Verification is read-only.
  const syncFullStoreToFirestore = useCallback(async () => {
    setIsSyncing(true);
    try {
      const response = await fetch('/api/firebase/status', { cache: 'no-store' });
      const status = await response.json();
      if (!response.ok || !status.connected || !status.authoritative) throw new Error(status.error || 'Firestore is not the active, reachable storage backend');
      setIsFirebaseAvailable(true); setLastSyncedAt(new Date());
      return { success: true, count: status.totalRecordsSynced };
    } catch (error: any) {
      setIsFirebaseAvailable(false);
      return { success: false, count: 0, error: error.message };
    } finally { setIsSyncing(false); }
  }, []);
  useEffect(() => { void syncFullStoreToFirestore(); }, [syncFullStoreToFirestore]);
  return <FirebaseContext.Provider value={{ user, authReady,
    isAdmin: !!user && user.email === 'avasophianorgaard@gmail.com' && user.emailVerified,
    isFirebaseAvailable, isSyncing, lastSyncedAt,
    signInWithGoogle: async () => { const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' }); await signInWithPopup(auth, provider); },
    logOut: () => signOut(auth), syncFullStoreToFirestore,
  }}>{children}</FirebaseContext.Provider>;
};
export function useFirebase() {
  const context = useContext(FirebaseContext);
  if (!context) throw new Error('useFirebase must be used within a FirebaseProvider');
  return context;
}
