// Phase 6A foundation only: server-owned exam settings and clock.
// NOT wired to any HTTP route or Cloudflare D1 write. No real student content.
// Inputs MUST come from server-read published versions, verified Firebase UIDs
// and trusted server/DB timestamps, never client supplied clocks.
const TOPIC_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/;
const QUESTION_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const STUDENT_UID=/^student_[a-f0-9]{32}$/;
const SESSION_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{15,99}$/;

function intBetween(value,min,max){
  return Number.isSafeInteger(value)&&value>=min&&value<=max;
}
function invalid(code){throw new Error(code);}

// Read settings only from an immutable, server-verified published revision.
// The question count is from server data, not a browser claim.
export function validatePublishedExamDefinition(version,questionCount){
  if(!version||version.state!=='published'||
     !TOPIC_ID.test(version.topic_id||'')||
     !intBetween(version.revision,1,100000)||
     !intBetween(version.time_limit_seconds,60,14400)||
     version.time_limit_seconds%60!==0||
     !intBetween(questionCount,1,500))
    invalid('PHASE6_EXAM_DEFINITION_INVALID');
  return Object.freeze({
    topicId:version.topic_id,
    revision:version.revision,
    timeLimitSeconds:version.time_limit_seconds,
    questionCount,
    maxScore:10, // Until a separate versioned score policy is implemented.
  });
}

export function buildServerExamSession({definition,verifiedStudentUid,sessionId,nowSeconds}){
  if(!definition||!TOPIC_ID.test(definition.topicId||'')||
     !intBetween(definition.revision,1,100000)||
     !intBetween(definition.timeLimitSeconds,60,14400)||
     definition.timeLimitSeconds%60!==0||
     !intBetween(definition.questionCount,1,500)||
     definition.maxScore!==10||
     !STUDENT_UID.test(verifiedStudentUid||'')||
     !SESSION_ID.test(sessionId||'')||
     !intBetween(nowSeconds,1,Number.MAX_SAFE_INTEGER-14400))
    invalid('PHASE6_SESSION_INVALID');
  return Object.freeze({
    sessionId,
    studentUid:verifiedStudentUid,
    topicId:definition.topicId,
    revision:definition.revision,
    questionCount:definition.questionCount,
    timeLimitSeconds:definition.timeLimitSeconds,
    startedAt:nowSeconds,
    expiresAt:nowSeconds+definition.timeLimitSeconds,
  });
}

// Server checks original stored session and fresh trusted timestamp.
// Deadline inclusive; a submission 1 second after expiry is rejected.
export function assertServerSubmissionWithinDeadline(session,verifiedStudentUid,nowSeconds){
  if(!session||!STUDENT_UID.test(session.studentUid||'')||
     !intBetween(session.startedAt,1,Number.MAX_SAFE_INTEGER-14400)||
     !intBetween(session.timeLimitSeconds,60,14400)||
     !intBetween(session.expiresAt,1,Number.MAX_SAFE_INTEGER)||
     session.expiresAt!==session.startedAt+session.timeLimitSeconds||
     !intBetween(nowSeconds,1,Number.MAX_SAFE_INTEGER))
    invalid('PHASE6_SESSION_INVALID');
  if(verifiedStudentUid!==session.studentUid)
    invalid('PHASE6_FORBIDDEN');
  if(nowSeconds<session.startedAt)
    invalid('PHASE6_SESSION_NOT_STARTED');
  if(nowSeconds>session.expiresAt)
    invalid('PHASE6_DEADLINE_EXPIRED');
  return true;
}

// Only server-private key rows are accepted, never browser correctIndex/score.
export function gradeAnswersOnServer(answerKeys,answers){
  if(!Array.isArray(answerKeys)||answerKeys.length<1||answerKeys.length>500||
     !answers||typeof answers!=='object'||Array.isArray(answers)||
     Object.keys(answers).length!==answerKeys.length)
    invalid('PHASE6_ANSWERS_INVALID');
  const ids=new Set();
  let correctCount=0;
  for(const row of answerKeys){
    if(!row||!QUESTION_ID.test(row.question_id||'')||
       !intBetween(row.correct_index,0,3)||ids.has(row.question_id))
      invalid('PHASE6_PRIVATE_KEYS_INVALID');
    ids.add(row.question_id);
    if(!Object.hasOwn(answers,row.question_id)||
       !intBetween(answers[row.question_id],0,3))
      invalid('PHASE6_ANSWERS_INVALID');
    if(answers[row.question_id]===row.correct_index)correctCount++;
  }
  const totalCount=answerKeys.length;
  const scoreTenths=Math.round(correctCount*100/totalCount);
  // Explicit projection: do NOT return private keys, answers or UID.
  return Object.freeze({correctCount,totalCount,scoreTenths,score:scoreTenths/10,maxScore:10});
}
