import {describe,test,expect} from 'bun:test';
import {
  SyntheticQuizDeliveryUncertainError,reconcileSyntheticQuizSubmission,
} from '../src/utils/syntheticQuizSubmissionRecovery';

type TestAttempt={quizId:'synthetic_math_v1',score:0|10};
const grade:TestAttempt={quizId:'synthetic_math_v1',score:10};
const prior:TestAttempt={quizId:'synthetic_math_v1',score:0};

describe('Phase 4G ambiguous DEMO submission recovery',()=>{
  test('new submission returns new without a second POST or extra D1 read',async()=>{
    let submissions=0,reads=0;
    const result=await reconcileSyntheticQuizSubmission(
      async()=>{submissions++;return {attempt:grade,disposition:'new' as const};},
      async()=>{reads++;return prior;},
    );
    expect(result).toEqual({attempt:grade,disposition:'new'});
    expect(submissions).toBe(1);
    expect(reads).toBe(0);
  });

  test('existing result is explicitly labelled rather than replaced',async()=>{
    let submissions=0,reads=0;
    const result=await reconcileSyntheticQuizSubmission(
      async()=>{submissions++;return {attempt:prior,disposition:'existing' as const};},
      async()=>{reads++;return grade;},
    );
    expect(result).toEqual({attempt:prior,disposition:'existing'});
    expect(submissions).toBe(1);
    expect(reads).toBe(0);
  });

  test('lost response after a successful POST reads D1 once, never POSTs twice',async()=>{
    let submissions=0,reads=0;
    const result=await reconcileSyntheticQuizSubmission<TestAttempt>(
      async()=>{submissions++;throw new SyntheticQuizDeliveryUncertainError();},
      async()=>{reads++;return grade;},
    );
    expect(result).toEqual({attempt:grade,disposition:'recovered'});
    expect(submissions).toBe(1);
    expect(reads).toBe(1);
  });

  test('another browser previously submitted a different score: never claim own new submission',async()=>{
    let submissions=0;
    const result=await reconcileSyntheticQuizSubmission<TestAttempt>(
      async()=>{submissions++;throw new SyntheticQuizDeliveryUncertainError();},
      async()=>prior,
    );
    expect(result).toEqual({attempt:prior,disposition:'recovered'});
    expect(submissions).toBe(1);
  });

  test('ambiguous failure but no grade found is an ERROR, not proof of a saved attempt',async()=>{
    let submissions=0,reads=0;
    await expect(reconcileSyntheticQuizSubmission<TestAttempt>(
      async()=>{submissions++;throw new SyntheticQuizDeliveryUncertainError();},
      async()=>{reads++;return null;},
    )).rejects.toBeInstanceOf(SyntheticQuizDeliveryUncertainError);
    expect(submissions).toBe(1);
    expect(reads).toBe(1);
  });

  test('ambiguous failure and failed read cannot fabricate a result or retry POST',async()=>{
    let submissions=0,reads=0;
    await expect(reconcileSyntheticQuizSubmission<TestAttempt>(
      async()=>{submissions++;throw new SyntheticQuizDeliveryUncertainError();},
      async()=>{reads++;throw new Error('D1_UNAVAILABLE');},
    )).rejects.toBeInstanceOf(SyntheticQuizDeliveryUncertainError);
    expect(submissions).toBe(1);
    expect(reads).toBe(1);
  });

  test('explicit 401/403/404/5xx errors must NEVER be converted into success',async()=>{
    for(const code of [401,403,404,500,503]){
      let submissions=0,reads=0;
      const error=new Error('HTTP_'+code);
      await expect(reconcileSyntheticQuizSubmission<TestAttempt>(
        async()=>{submissions++;throw error;},
        async()=>{reads++;return grade;},
      )).rejects.toBe(error);
      expect(submissions).toBe(1);
      expect(reads).toBe(0);
    }
  });
});
