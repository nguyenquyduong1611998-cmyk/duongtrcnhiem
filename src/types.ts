export type UserRole = 'admin' | 'student';

export interface UserAccount {
  id: string;
  username: string;
  password: string;
  fullName: string;
  defaultUnit: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Question {
  id: string;
  text: string;
  options: [string, string, string, string];
  correctIndex: number; // 0 = A, 1 = B, 2 = C, 3 = D
  explanation: string;
}

export interface Topic {
  id: string;
  code: string;
  title: string;
  description: string;
  timeLimitMinutes: number;
  questions: Question[];
  createdAt: string;
  updatedAt: string;
}

export type GradeLevel = 'Giỏi' | 'Khá' | 'Đạt' | 'Yếu';

export interface QuizAttempt {
  id: string;
  accountUsername: string;
  candidateName: string;
  unitName: string;
  topicId: string;
  topicTitle: string;
  answers: Record<string, number>;
  correctCount: number;
  totalCount: number;
  score10: number;
  grade: GradeLevel;
  durationSeconds: number;
  startedAt: string;
  submittedAt: string;
}

export interface CandidateSummary {
  key: string;
  candidateName: string;
  unitNames: string[];
  accountUsernames: string[];
  totalAttempts: number;
  gioiCount: number;
  khaCount: number;
  datCount: number;
  yeuCount: number;
  bestScore10: number;
  avgScore10: number;
  latestSubmittedAt: string;
  attempts: QuizAttempt[];
}

export interface AccountGroupSummary {
  accountUsername: string;
  accountLabel: string;
  candidateNames: string[];
  totalAttempts: number;
  gioiCount: number;
  khaCount: number;
  datCount: number;
  yeuCount: number;
  avgScore10: number;
  bestScore10: number;
  latestSubmittedAt: string;
  attempts: QuizAttempt[];
}

export type MainTab = 'topics' | 'history' | 'honor' | 'admin';

export interface SystemBackupPayload {
  version: number;
  exportedAt: string;
  type: 'accounts_only' | 'full_system';
  accounts: UserAccount[];
  topics?: Topic[];
  attempts?: QuizAttempt[];
}
