import { DEFAULT_ACCOUNTS, DEFAULT_ATTEMPTS, DEFAULT_TOPICS } from '../data/defaultData';
import { QuizAttempt, SystemBackupPayload, Topic, UserAccount } from '../types';

// Keep synthetic staging topic tests out of the normal learning-data cache.
const IS_STAGING = import.meta.env.VITE_FIREBASE_ENV === 'staging';
const SYNTHETIC_TOPIC_ID = 'staging_test_topic_20261121';
function withoutSyntheticTopic(topics: Topic[]): Topic[] {
  return IS_STAGING ? topics.filter((t) => t.id !== SYNTHETIC_TOPIC_ID) : topics;
}

const KEYS = {
  ACCOUNTS: 'tinhoc490_accounts_v1',
  TOPICS: 'tinhoc490_topics_v1',
  ATTEMPTS: 'tinhoc490_attempts_v1',
  SESSION_USER_ID: 'tinhoc490_session_user_id_v1',
};

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadAccounts(): UserAccount[] {
  const existing = localStorage.getItem(KEYS.ACCOUNTS);
  if (!existing) {
    localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(DEFAULT_ACCOUNTS));
    return DEFAULT_ACCOUNTS;
  }
  const parsed = safeParse<UserAccount[]>(existing, DEFAULT_ACCOUNTS);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(DEFAULT_ACCOUNTS));
    return DEFAULT_ACCOUNTS;
  }
  // Ensure root admin always exists so admin can never lock themselves out permanently
  const hasAdmin = parsed.some((a) => a.username.toLowerCase() === 'admin');
  if (!hasAdmin) {
    const restored = [DEFAULT_ACCOUNTS[0], ...parsed];
    localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(restored));
    return restored;
  }
  return parsed;
}

export function saveAccounts(accounts: UserAccount[]): void {
  localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(accounts));
}

export function loadTopics(): Topic[] {
  const existing = localStorage.getItem(KEYS.TOPICS);
  if (!existing) {
    localStorage.setItem(KEYS.TOPICS, JSON.stringify(DEFAULT_TOPICS));
    return DEFAULT_TOPICS;
  }
  const parsed = safeParse<Topic[]>(existing, DEFAULT_TOPICS);
  if (!Array.isArray(parsed)) {
    localStorage.setItem(KEYS.TOPICS, JSON.stringify(DEFAULT_TOPICS));
    return DEFAULT_TOPICS;
  }
  const cleaned = withoutSyntheticTopic(parsed);
  if (cleaned.length !== parsed.length) {
    // A prior staging build may have replaced all real topics with the one test
    // document. Restore bundled demo topics in that one specific case.
    const recovered = cleaned.length > 0 ? cleaned : DEFAULT_TOPICS;
    localStorage.setItem(KEYS.TOPICS, JSON.stringify(recovered));
    return recovered;
  }
  return parsed;
}

export function saveTopics(topics: Topic[]): void {
  localStorage.setItem(KEYS.TOPICS, JSON.stringify(withoutSyntheticTopic(topics)));
}

export function loadAttempts(): QuizAttempt[] {
  const existing = localStorage.getItem(KEYS.ATTEMPTS);
  if (!existing) {
    localStorage.setItem(KEYS.ATTEMPTS, JSON.stringify(DEFAULT_ATTEMPTS));
    return DEFAULT_ATTEMPTS;
  }
  const parsed = safeParse<QuizAttempt[]>(existing, DEFAULT_ATTEMPTS);
  if (!Array.isArray(parsed)) {
    localStorage.setItem(KEYS.ATTEMPTS, JSON.stringify(DEFAULT_ATTEMPTS));
    return DEFAULT_ATTEMPTS;
  }
  return parsed;
}

export function saveAttempts(attempts: QuizAttempt[]): void {
  localStorage.setItem(KEYS.ATTEMPTS, JSON.stringify(attempts));
}

export function loadSessionUserId(): string | null {
  return localStorage.getItem(KEYS.SESSION_USER_ID);
}

export function saveSessionUserId(userId: string | null): void {
  if (userId) {
    localStorage.setItem(KEYS.SESSION_USER_ID, userId);
  } else {
    localStorage.removeItem(KEYS.SESSION_USER_ID);
  }
}

export function exportAccountsBackup(accounts: UserAccount[]): string {
  const payload: SystemBackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    type: 'accounts_only',
    accounts,
  };
  return JSON.stringify(payload, null, 2);
}

export function exportFullBackup(
  accounts: UserAccount[],
  topics: Topic[],
  attempts: QuizAttempt[]
): string {
  const payload: SystemBackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    type: 'full_system',
    accounts,
    topics,
    attempts,
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadTextFile(filename: string, content: string, mime = 'application/json;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
