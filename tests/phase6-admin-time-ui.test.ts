// @ts-expect-error Bun test-runtime module is not included in browser declarations.
import {test,expect} from 'bun:test';
import {
  PHASE6_TIME_PRESETS,isValidPhase6Minutes,getPhase6RemainingSeconds,
} from '../src/utils/phase6ExamTime';

test('Admin has standard presets but can save any integral duration from 1 to 240 minutes',()=>{
  expect([...PHASE6_TIME_PRESETS]).toEqual([15,30,45,60]);
  for(const candidate of [1,2,15,30,45,60,90,180,239,240])
    expect(isValidPhase6Minutes(candidate)).toBe(true);
  for(const invalid of [0,-1,241,Infinity,NaN,30.5,'15','',null,undefined,{},true])
    expect(isValidPhase6Minutes(invalid)).toBe(false);
});

test('student display countdown uses fixed server expiry and monotonic elapsed milliseconds',()=>{
  const serverNow=1_800_000_000,expiresAt=serverNow+15*60;
  const received=10_000;
  expect(getPhase6RemainingSeconds(expiresAt,serverNow,received,received)).toBe(900);
  expect(getPhase6RemainingSeconds(expiresAt,serverNow,received,received+999)).toBe(900);
  expect(getPhase6RemainingSeconds(expiresAt,serverNow,received,received+1000)).toBe(899);
  expect(getPhase6RemainingSeconds(expiresAt,serverNow,received,received+15*60_000)).toBe(0);
  expect(getPhase6RemainingSeconds(expiresAt,serverNow,received,received+24*60*60_000)).toBe(0);
  expect(getPhase6RemainingSeconds(expiresAt,serverNow,received,received-5000)).toBe(900);
  expect(getPhase6RemainingSeconds(serverNow-10,serverNow,received,received)).toBe(0);
});

test('untrusted or corrupt UI time values fail closed',()=>{
  const v=1_800_000_000;
  const invalidCases:Array<[number,number,number,number]> = [
    [v+60,v,NaN,1000],
    [v+60,v,1000,Infinity],
    [v+60,0,1000,2000],
    [v+60.5,v,1000,2000],
    [v+60,v+0.5,1000,2000],
  ];
  for(const invalid of invalidCases)
    expect(getPhase6RemainingSeconds(...invalid)).toBe(0);
});
