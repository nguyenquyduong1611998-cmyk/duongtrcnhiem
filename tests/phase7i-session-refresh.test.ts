// @ts-expect-error Bun test-runtime module is not in browser declarations.
import {test,expect} from 'bun:test';
import type {Phase6ExamState} from '../src/utils/phase6StudentExam';
import {retainPhase6LocalSelections} from '../src/utils/phase7SessionRefresh';

const topicId='p6_demo_'+'a'.repeat(32);
const sessionId='p6_session_'+'b'.repeat(32);
const session={
  sessionId,topicId,revision:2,questionCount:2,timeLimitSeconds:900,
  startedAt:1800000000,expiresAt:1800000900,serverNow:1800000060,
};
const topic={title:'Toán học DEMO',questions:[
  {id:'q1',orderIndex:1,text:'2 + 2 = ?',options:['3','4','5','6']},
  {id:'q2',orderIndex:2,text:'10 - 3 = ?',options:['5','6','7','8']},
]};
const initial:Phase6ExamState={session,topic,result:null};
const refreshed:Phase6ExamState={
  session:{...session,serverNow:1800000300},topic:{...topic},result:null,
};

test('refresh of the same signed session retains only valid in-memory picks',()=>{
  expect(retainPhase6LocalSelections(initial,refreshed,{q1:1,q2:2}))
    .toEqual({q1:1,q2:2});
  expect(retainPhase6LocalSelections(initial,refreshed,{
    q1:1,q2:4,secret:2,
  })).toEqual({q1:1});
  expect(retainPhase6LocalSelections(initial,refreshed,{
    q1:0,q2:0,
  })).toEqual({q1:0,q2:0});
});

test('another student/session, revision, deadline or question set drops stale picks',()=>{
  const changedSession=[
    {...session,sessionId:'p6_session_'+'c'.repeat(32)},
    {...session,topicId:'p6_demo_'+'d'.repeat(32)},
    {...session,revision:3},
    {...session,startedAt:session.startedAt+10,expiresAt:session.expiresAt+10},
    {...session,timeLimitSeconds:1200,expiresAt:session.startedAt+1200},
    {...session,serverNow:session.expiresAt+1},
  ];
  for(const nextSession of changedSession)
    expect(retainPhase6LocalSelections(initial,{
      ...refreshed,session:nextSession,
    },{q1:1,q2:2})).toEqual({});
  const changedTopics=[
    {...topic,title:'Khác'},
    {...topic,questions:[topic.questions[1],topic.questions[0]]},
    {...topic,questions:[{...topic.questions[0],options:['4','3','5','6']},topic.questions[1]]},
    {...topic,questions:[{...topic.questions[0],id:'another'},topic.questions[1]]},
    {...topic,questions:[{...topic.questions[0],text:'Khác'},topic.questions[1]]},
  ];
  for(const nextTopic of changedTopics)
    expect(retainPhase6LocalSelections(initial,{
      ...refreshed,topic:nextTopic,
    },{q1:1,q2:2})).toEqual({});
});

test('after submission or without a matching started session never retain answers',()=>{
  const result={
    topicId,revision:2,correctCount:2,totalCount:2,score:10,
    maxScore:10 as const,submittedAt:1800000301,
    status:'submitted' as const,
  };
  expect(retainPhase6LocalSelections(initial,{
    ...refreshed,result,
  },{q1:1,q2:2})).toEqual({});
  expect(retainPhase6LocalSelections({session:null},refreshed,{q1:1}))
    .toEqual({});
  expect(retainPhase6LocalSelections(null,refreshed,{q1:1}))
    .toEqual({});
  expect(retainPhase6LocalSelections(initial,{session:null},{q1:1}))
    .toEqual({});
});
