import { expect, test } from 'bun:test';
import {
  MAX_PRACTICE_MINUTES,
  getDefaultPracticeMinutes,
  getElapsedPracticeSeconds,
  parsePracticeMinutes,
} from '../src/utils/quizTiming';

test('practice duration starts with existing per-topic default', () => {
  expect(getDefaultPracticeMinutes(15)).toBe(15);
  expect(getDefaultPracticeMinutes(30)).toBe(30);
  expect(getDefaultPracticeMinutes(0)).toBe(15);
  expect(getDefaultPracticeMinutes(Number.NaN)).toBe(15);
  expect(getDefaultPracticeMinutes(9999)).toBe(MAX_PRACTICE_MINUTES);
});

test('duration must be a whole number in the allowed range', () => {
  for (const value of ['1', '15', '45', '180', ' 20 ']) {
    expect(parsePracticeMinutes(value)).not.toBeNull();
  }
  for (const value of ['', '0', '-1', '1.5', '181', '999', 'Infinity', '20min', '01']) {
    expect(parsePracticeMinutes(value)).toBeNull();
  }
});

test('elapsed seconds use actual start timestamp, including tab suspension', () => {
  const startedAtIso = '2026-11-25T08:00:00.000Z';
  const startedAtMs = Date.parse(startedAtIso);
  expect(getElapsedPracticeSeconds(startedAtIso, startedAtMs)).toBe(0);
  expect(getElapsedPracticeSeconds(startedAtIso, startedAtMs + 1299)).toBe(1);
  expect(getElapsedPracticeSeconds(startedAtIso, startedAtMs + 8 * 60 * 1000)).toBe(480);
  expect(getElapsedPracticeSeconds(startedAtIso, startedAtMs - 5000)).toBe(0);
  expect(getElapsedPracticeSeconds('invalid', startedAtMs)).toBe(0);
});
