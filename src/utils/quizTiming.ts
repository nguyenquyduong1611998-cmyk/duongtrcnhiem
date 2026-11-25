// The existing local practice flow is separate from server-graded Phase 5 exams.
export const MAX_PRACTICE_MINUTES = 180;

export function getDefaultPracticeMinutes(configuredMinutes: number): number {
  if (!Number.isFinite(configuredMinutes) || configuredMinutes < 1) return 15;
  return Math.min(MAX_PRACTICE_MINUTES, Math.max(1, Math.trunc(configuredMinutes)));
}

export function parsePracticeMinutes(value: string): number | null {
  const clean = value.trim();
  if (!/^[1-9]\d{0,2}$/.test(clean)) return null;
  const minutes = Number(clean);
  return minutes <= MAX_PRACTICE_MINUTES ? minutes : null;
}

// Wall-clock-based time survives suspended tabs better than incrementing a counter.
export function getElapsedPracticeSeconds(startedAtIso: string, nowMs: number): number {
  const startedAtMs = Date.parse(startedAtIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}
