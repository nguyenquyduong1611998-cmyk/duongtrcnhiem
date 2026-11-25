// Client-only practice quiz timer. Not a server-enforced exam deadline.
// A candidate may choose their allotted minutes BEFORE starting a practice
// attempt, but the active attempt's limit remains fixed until completion.
export const MIN_QUIZ_MINUTES=1;
export const MAX_QUIZ_MINUTES=240;
export const FALLBACK_QUIZ_MINUTES=10;

export function defaultQuizMinutes(raw:number):number {
  if(!Number.isFinite(raw)||!Number.isSafeInteger(raw)||raw<MIN_QUIZ_MINUTES)
    return FALLBACK_QUIZ_MINUTES;
  return Math.min(MAX_QUIZ_MINUTES,raw);
}

export function parseQuizMinutes(value:string):number|null {
  const input=value.trim();
  if(!/^[0-9]{1,3}$/.test(input))return null;
  const n=Number(input);
  return Number.isSafeInteger(n)&&n>=MIN_QUIZ_MINUTES&&
    n<=MAX_QUIZ_MINUTES?n:null;
}

// Wall-clock countdown catches up when a tab is suspended/in background.
// The timer itself is not an anti-cheating control; the browser owns its clock.
export function elapsedQuizSeconds(
  startedAtMs:number,nowMs:number,minutes:number
):number{
  const maxSeconds=minutes*60;
  if(!Number.isFinite(startedAtMs)||!Number.isFinite(nowMs)||
     !Number.isSafeInteger(minutes)||minutes<MIN_QUIZ_MINUTES||
     minutes>MAX_QUIZ_MINUTES)return 0;
  return Math.min(maxSeconds,Math.max(0,Math.floor((nowMs-startedAtMs)/1000)));
}
