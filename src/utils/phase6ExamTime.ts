// Preview-only Phase 6 UI timing helpers. No browser clock is trusted for D1 deadlines.
// The backend still owns all start/expiry timestamps and submission validation.
export const PHASE6_TIME_PRESETS = [15, 30, 45, 60] as const;

export function isValidPhase6Minutes(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 240;
}

// Countdown is display-only: elapsed time comes from a monotonic timer, not Date.now().
// Reconnect/read the server session if the device slept or the UI looks stale.
export function getPhase6RemainingSeconds(
  expiresAt: number,
  serverNow: number,
  receivedAtMonotonicMs: number,
  nowMonotonicMs: number,
): number {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0 ||
      !Number.isSafeInteger(serverNow) || serverNow <= 0 ||
      !Number.isFinite(receivedAtMonotonicMs) ||
      !Number.isFinite(nowMonotonicMs)) return 0;
  const elapsedMs = Math.max(0, nowMonotonicMs - receivedAtMonotonicMs);
  return Math.max(0, expiresAt - serverNow - Math.floor(elapsedMs / 1000));
}
