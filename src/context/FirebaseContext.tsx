import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, testConnection, handleFirestoreError, OperationType } from '../firebase';
import { AttendanceRecord, Student } from '../types';

interface FirebaseContextType {
  user: User | null;
  authReady: boolean;
  isAdmin: boolean;
  isFirebaseAvailable: boolean;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  signInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  syncRecordToFirestore: (record: AttendanceRecord) => Promise<void>;
  syncStudentToFirestore: (student: Student) => Promise<void>;
  syncFullStoreToFirestore: () => Promise<{ success: boolean; count: number; error?: string }>;
  loadRecordsFromFirestore: (date: string) => Promise<AttendanceRecord[] | null>;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

const ADMIN_EMAIL = 'avasophianorgaard@gmail.com';

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isFirebaseAvailable, setIsFirebaseAvailable] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Connection probe on boot
  useEffect(() => {
    testConnection().then((available) => {
      setIsFirebaseAvailable(available);
    });
  }, []);

  // Track auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const isAdmin = Boolean(
    user && user.email === ADMIN_EMAIL && user.emailVerified
  );

  const signInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error('Firebase Auth sign in error:', err);
      throw err;
    }
  };

  const logOut = async () => {
    await signOut(auth);
  };

  // Sync a single record to Firestore
  const syncRecordToFirestore = useCallback(
    async (record: AttendanceRecord) => {
      if (!user) return;
      const path = `attendance_records/${record.id}`;
      try {
        const cleanRecord = {
          id: String(record.id).slice(0, 128),
          studentId: String(record.studentId).slice(0, 128),
          studentName: String(record.studentName).slice(0, 128),
          date: record.date,
          status: record.status,
          clockInTime: record.clockInTime || null,
          clockInTimestamp: record.clockInTimestamp || null,
          clockOutTime: record.clockOutTime || null,
          clockOutTimestamp: record.clockOutTimestamp || null,
          durationMinutes: typeof record.durationMinutes === 'number' ? record.durationMinutes : null,
          laptopsImaged: typeof record.laptopsImaged === 'number' ? record.laptopsImaged : 0,
          isFlagged: Boolean(record.isFlagged),
          flagReason: record.flagReason ? String(record.flagReason).slice(0, 256) : null,
          post415Exceeded: Boolean(record.post415Exceeded),
          cutoffExceeded: Boolean(record.cutoffExceeded),
          checkedInByClientId: record.checkedInByClientId ? String(record.checkedInByClientId).slice(0, 128) : null,
          checkedOutByClientId: record.checkedOutByClientId ? String(record.checkedOutByClientId).slice(0, 128) : null,
        };

        await setDoc(doc(db, 'attendance_records', record.id), cleanRecord, { merge: true });
        setLastSyncedAt(new Date());
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [user]
  );

  // Sync custom student to Firestore
  const syncStudentToFirestore = useCallback(
    async (student: Student) => {
      if (!user) return;
      const path = `students/${student.id}`;
      try {
        await setDoc(
          doc(db, 'students', student.id),
          {
            id: student.id,
            name: student.name,
            lastName: student.lastName,
            firstName: student.firstName,
            isCustom: true,
          },
          { merge: true }
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [user]
  );

  // Sync entire attendance store to Firestore in batches
  const syncFullStoreToFirestore = useCallback(async () => {
    if (!user) {
      return { success: false, count: 0, error: 'Sign in with Google required to sync with Firebase' };
    }
    setIsSyncing(true);
    try {
      // Fetch latest store from local server endpoint
      const res = await fetch('/api/store-dump');
      if (!res.ok) {
        throw new Error('Failed to load store for Firebase sync');
      }
      const data = await res.json();
      const recordsByDate: Record<string, Record<string, AttendanceRecord>> = data.recordsByDate || {};

      let totalSynced = 0;
      let currentBatch = writeBatch(db);
      let batchCount = 0;

      for (const [date, records] of Object.entries(recordsByDate)) {
        for (const record of Object.values(records)) {
          const docRef = doc(db, 'attendance_records', record.id);
          const cleanRecord = {
            id: String(record.id).slice(0, 128),
            studentId: String(record.studentId).slice(0, 128),
            studentName: String(record.studentName).slice(0, 128),
            date,
            status: record.status,
            clockInTime: record.clockInTime || null,
            clockInTimestamp: record.clockInTimestamp || null,
            clockOutTime: record.clockOutTime || null,
            clockOutTimestamp: record.clockOutTimestamp || null,
            durationMinutes: typeof record.durationMinutes === 'number' ? record.durationMinutes : null,
            laptopsImaged: typeof record.laptopsImaged === 'number' ? record.laptopsImaged : 0,
            isFlagged: Boolean(record.isFlagged),
            flagReason: record.flagReason ? String(record.flagReason).slice(0, 256) : null,
            post415Exceeded: Boolean(record.post415Exceeded),
            cutoffExceeded: Boolean(record.cutoffExceeded),
            checkedInByClientId: record.checkedInByClientId ? String(record.checkedInByClientId).slice(0, 128) : null,
            checkedOutByClientId: record.checkedOutByClientId ? String(record.checkedOutByClientId).slice(0, 128) : null,
          };

          currentBatch.set(docRef, cleanRecord, { merge: true });
          batchCount++;
          totalSynced++;

          if (batchCount >= 450) {
            await currentBatch.commit();
            currentBatch = writeBatch(db);
            batchCount = 0;
          }
        }
      }

      if (batchCount > 0) {
        await currentBatch.commit();
      }

      setLastSyncedAt(new Date());
      setIsSyncing(false);
      return { success: true, count: totalSynced };
    } catch (err: any) {
      setIsSyncing(false);
      console.error('Error syncing store to Firestore:', err);
      return { success: false, count: 0, error: err?.message || String(err) };
    }
  }, [user]);

  // Load records from Firestore for a given date
  const loadRecordsFromFirestore = useCallback(
    async (date: string): Promise<AttendanceRecord[] | null> => {
      if (!user) return null;
      const path = 'attendance_records';
      try {
        const q = query(collection(db, path), where('date', '==', date));
        const snapshot = await getDocs(q);
        const records: AttendanceRecord[] = [];
        snapshot.forEach((d) => {
          records.push(d.data() as AttendanceRecord);
        });
        return records;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, path);
      }
    },
    [user]
  );

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        isAdmin,
        isFirebaseAvailable,
        isSyncing,
        lastSyncedAt,
        signInWithGoogle,
        logOut,
        syncRecordToFirestore,
        syncStudentToFirestore,
        syncFullStoreToFirestore,
        loadRecordsFromFirestore,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (!context) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
};
