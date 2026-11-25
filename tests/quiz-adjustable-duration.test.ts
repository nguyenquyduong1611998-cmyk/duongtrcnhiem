// @ts-expect-error Bun test-runtime module is not in browser TS declarations.
import {test,expect} from 'bun:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Topic,UserAccount} from '../src/types';
import {QuizFlow} from '../src/components/QuizFlow';
import {
  MIN_QUIZ_MINUTES,MAX_QUIZ_MINUTES,defaultQuizMinutes,
  parseQuizMinutes,elapsedQuizSeconds,
} from '../src/utils/quizDuration';

const topic:Topic={
  id:'synthetic-quiz-adjustable-duration',
  code:'DEMO',title:'Toán học giả',
  description:'Kiểm tra số phút trước khi bắt đầu',
  timeLimitMinutes:15,
  questions:[{id:'q1',text:'1+1?',options:['0','2','3','4'],
    correctIndex:1,explanation:'Giả lập'}],
  createdAt:'2026-11-25T01:00:00Z',updatedAt:'2026-11-25T01:00:00Z',
};
const user:UserAccount={
  id:'test-local-uid',username:'test_user',password:'',
  fullName:'',defaultUnit:'',role:'student',active:true,
  createdAt:'2026-11-25T01:00:00Z',updatedAt:'2026-11-25T01:00:00Z',
};

test('defaults to original topic limit and exposes numeric pre-start control',()=>{
  const html=renderToStaticMarkup(React.createElement(QuizFlow,{
    topic,currentUser:user,onCompleteAttempt:()=>{},onExit:()=>{},
  }));
  expect(html).toContain('Thời gian làm bài (phút)');
  expect(html).toContain('id="quiz-time-minutes"');
  expect(html).toContain('value="15"');
  expect(html).toContain('min="1"');
  expect(html).toContain('max="240"');
  expect(html).toContain('Bắt đầu làm bài');
  expect(html).toContain('thời gian đã chọn không thể đổi'.replace('thời','Thời'));
});

test('custom duration validation has strict bounded integral minutes',()=>{
  expect(MIN_QUIZ_MINUTES).toBe(1);
  expect(MAX_QUIZ_MINUTES).toBe(240);
  for(const n of [1,2,5,15,30,45,60,90,120,180,240])
    expect(parseQuizMinutes(String(n))).toBe(n);
  for(const bad of ['','0','-1','241','999','1.5','2e2',
    'Infinity','NaN','a','10min','00.5','11-12'])
    expect(parseQuizMinutes(bad)).toBeNull();
  expect(parseQuizMinutes(' 25 ')).toBe(25);
});

test('invalid legacy topic limits use fallback, overly large defaults are bounded',()=>{
  expect(defaultQuizMinutes(15)).toBe(15);
  expect(defaultQuizMinutes(0)).toBe(10);
  expect(defaultQuizMinutes(-1)).toBe(10);
  expect(defaultQuizMinutes(Number.NaN)).toBe(10);
  expect(defaultQuizMinutes(10.5)).toBe(10);
  expect(defaultQuizMinutes(241)).toBe(240);
});

test('timer uses actual wall-clock passed across suspension, not interval ticks',()=>{
  const begin=1_800_000_000_000;
  expect(elapsedQuizSeconds(begin,begin,2)).toBe(0);
  expect(elapsedQuizSeconds(begin,begin+995,2)).toBe(0);
  expect(elapsedQuizSeconds(begin,begin+59_999,2)).toBe(59);
  expect(elapsedQuizSeconds(begin,begin+60_000,2)).toBe(60);
  expect(elapsedQuizSeconds(begin,begin+120_000,2)).toBe(120);
  expect(elapsedQuizSeconds(begin,begin+350_000,2)).toBe(120);
  expect(elapsedQuizSeconds(begin,begin-5000,2)).toBe(0);
  expect(elapsedQuizSeconds(begin,begin+15*60_000,15)).toBe(900);
  expect(elapsedQuizSeconds(begin,begin+Number.MAX_SAFE_INTEGER,15)).toBe(900);
  expect(elapsedQuizSeconds(begin,begin+20_000,0)).toBe(0);
});
