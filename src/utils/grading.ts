import { AccountGroupSummary, CandidateSummary, GradeLevel, QuizAttempt, UserAccount } from '../types';

export function calculateScore10(correctCount: number, totalCount: number): number {
  if (totalCount <= 0) return 0;
  const raw = (correctCount / totalCount) * 10;
  return Math.round(raw * 10) / 10;
}

export function formatScore10(score10: number): string {
  const rounded = Math.round(score10 * 10) / 10;
  const display = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${display} điểm`;
}

export function getGradeLevel(score10: number): GradeLevel {
  if (score10 >= 8) return 'Giỏi';
  if (score10 >= 6.5) return 'Khá';
  if (score10 >= 5) return 'Đạt';
  return 'Yếu';
}

export function getGradeBadgeStyle(grade: GradeLevel): {
  text: string;
  bg: string;
  border: string;
} {
  switch (grade) {
    case 'Giỏi':
      return {
        text: 'text-[#166534]',
        bg: 'bg-[#ECFDF5]',
        border: 'border-[#BBF7D0]',
      };
    case 'Khá':
      return {
        text: 'text-[#1D4ED8]',
        bg: 'bg-[#EFF6FF]',
        border: 'border-[#BFDBFE]',
      };
    case 'Đạt':
      return {
        text: 'text-[#9A5B06]',
        bg: 'bg-[#FFFBEB]',
        border: 'border-[#FDE68A]',
      };
    case 'Yếu':
      return {
        text: 'text-[#B91C1C]',
        bg: 'bg-[#FEF2F2]',
        border: 'border-[#FECACA]',
      };
  }
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  if (mins === 0) {
    return `${secs} giây`;
  }
  return `${String(mins).padStart(2, '0')} phút ${String(secs).padStart(2, '0')} giây`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${hh}:${mm}:${ss} · ${dd}/${mo}/${yyyy}`;
}

export function normalizeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function groupAttemptsByCandidate(attempts: QuizAttempt[]): CandidateSummary[] {
  const map = new Map<string, QuizAttempt[]>();

  for (const attempt of attempts) {
    const key = normalizeNameKey(attempt.candidateName);
    if (!key) continue;
    const list = map.get(key);
    if (list) {
      list.push(attempt);
    } else {
      map.set(key, [attempt]);
    }
  }

  const summaries: CandidateSummary[] = [];

  for (const [key, list] of map.entries()) {
    const sortedAttempts = [...list].sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );

    let gioiCount = 0;
    let khaCount = 0;
    let datCount = 0;
    let yeuCount = 0;
    let sumScore = 0;
    let bestScore10 = 0;

    const unitSet = new Set<string>();
    const accountSet = new Set<string>();

    for (const item of sortedAttempts) {
      if (item.grade === 'Giỏi') gioiCount += 1;
      else if (item.grade === 'Khá') khaCount += 1;
      else if (item.grade === 'Đạt') datCount += 1;
      else yeuCount += 1;

      sumScore += item.score10;
      if (item.score10 > bestScore10) bestScore10 = item.score10;
      if (item.unitName.trim()) unitSet.add(item.unitName.trim());
      if (item.accountUsername.trim()) accountSet.add(item.accountUsername.trim());
    }

    const avgScore10 = Math.round((sumScore / sortedAttempts.length) * 10) / 10;

    summaries.push({
      key,
      candidateName: sortedAttempts[0].candidateName.trim(),
      unitNames: Array.from(unitSet),
      accountUsernames: Array.from(accountSet),
      totalAttempts: sortedAttempts.length,
      gioiCount,
      khaCount,
      datCount,
      yeuCount,
      bestScore10,
      avgScore10,
      latestSubmittedAt: sortedAttempts[0].submittedAt,
      attempts: sortedAttempts,
    });
  }

  return summaries.sort((a, b) => {
    if (b.gioiCount !== a.gioiCount) return b.gioiCount - a.gioiCount;
    if (b.bestScore10 !== a.bestScore10) return b.bestScore10 - a.bestScore10;
    if (b.avgScore10 !== a.avgScore10) return b.avgScore10 - a.avgScore10;
    return b.totalAttempts - a.totalAttempts;
  });
}

export function groupAttemptsByAccount(
  attempts: QuizAttempt[],
  accounts: UserAccount[]
): AccountGroupSummary[] {
  const map = new Map<string, QuizAttempt[]>();
  const accountLookup = new Map<string, UserAccount>();
  for (const acc of accounts) {
    accountLookup.set(acc.username.toLowerCase(), acc);
  }

  for (const attempt of attempts) {
    const accKey = attempt.accountUsername.trim() || 'khong_xac_dinh';
    const list = map.get(accKey);
    if (list) list.push(attempt);
    else map.set(accKey, [attempt]);
  }

  const groups: AccountGroupSummary[] = [];

  for (const [accountUsername, list] of map.entries()) {
    const sortedAttempts = [...list].sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );

    let gioiCount = 0;
    let khaCount = 0;
    let datCount = 0;
    let yeuCount = 0;
    let sumScore = 0;
    let bestScore10 = 0;
    const candidateMap = new Map<string, string>();

    for (const item of sortedAttempts) {
      if (item.grade === 'Giỏi') gioiCount += 1;
      else if (item.grade === 'Khá') khaCount += 1;
      else if (item.grade === 'Đạt') datCount += 1;
      else yeuCount += 1;

      sumScore += item.score10;
      if (item.score10 > bestScore10) bestScore10 = item.score10;
      const cKey = normalizeNameKey(item.candidateName);
      if (cKey && !candidateMap.has(cKey)) {
        candidateMap.set(cKey, item.candidateName.trim());
      }
    }

    const matchedAcc = accountLookup.get(accountUsername.toLowerCase());
    const avgScore10 = Math.round((sumScore / sortedAttempts.length) * 10) / 10;

    groups.push({
      accountUsername,
      accountLabel: matchedAcc?.fullName
        ? `${accountUsername} (${matchedAcc.fullName})`
        : accountUsername,
      candidateNames: Array.from(candidateMap.values()),
      totalAttempts: sortedAttempts.length,
      gioiCount,
      khaCount,
      datCount,
      yeuCount,
      avgScore10,
      bestScore10,
      latestSubmittedAt: sortedAttempts[0].submittedAt,
      attempts: sortedAttempts,
    });
  }

  return groups.sort((a, b) => {
    if (b.totalAttempts !== a.totalAttempts) return b.totalAttempts - a.totalAttempts;
    return b.avgScore10 - a.avgScore10;
  });
}
