import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
    reload,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';

import productionConfig from '../firebase-applet-config.json';
import stagingConfig from '../firebase-staging-config.json';
import {shouldUseStagingFirebase} from './utils/firebaseStagingHost';

// Always select staging on the separately hosted Cloudflare Pages test project.
// This also protects Preview deployments if their Vite env is misconfigured.
export const IS_FIREBASE_STAGING = shouldUseStagingFirebase(
  import.meta.env.VITE_FIREBASE_ENV,
  typeof window!=='undefined'?window.location.hostname:'',
);

const firebaseConfig = IS_FIREBASE_STAGING
  ? stagingConfig
  : productionConfig;

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const BOOTSTRAPPED_ADMIN_EMAIL = 'nguyenquyduong1611998@gmail.com';



export const BOOTSTRAPPED_ADMIN_UID = IS_FIREBASE_STAGING
  ? 'aV2S9WYo4tg8XZQSE9snzjeBU203'
  : '3zPu6ZrPGLfDNsms17mxHrEwfUF2';



export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();


export async function signInWithGoogleCloud() {
  const result = await signInWithPopup(auth, googleProvider);

  await reload(result.user);

  console.info('[Firebase] Google sign-in result:', {
    hasEmail: Boolean(result.user.email),
    emailVerified: result.user.emailVerified,
    providers: result.user.providerData.map(p => p.providerId),
  });

  return result;
}

export async function signOutGoogleCloud() {
  return signOut(auth);
}
